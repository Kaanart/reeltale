// The AI scene pipeline as a sequence of durable steps. Kept free of cloudflare:* imports so it runs
// under Node tests with a fake step runner; story-scene.ts adapts it to Cloudflare Workflows.
//
// Each paid model call is its own step: a finished step's result is memoised, so a retry or a resumed
// instance never pays for it again. Bytes go to R2 inside the step and only keys are returned. Budget
// is reserved per step name in Postgres (idempotent), so a retried step doesn't reserve twice.

import type { FocusBox, SceneScript, StoryArc, StoryBible, StoryManifest } from '@reeltale/shared';
import { DbError } from '../lib/db.ts';
import { MetaApiError } from '../ai/meta.ts';
import {
  BlockedError, buildManifest, checkOutcome, checkPanels, drawCharacterSheets, drawPanel, focusBox, keys, planStory,
  writeScene, type SceneDeps,
} from '../ai/scene.ts';

export interface StepConfig {
  retries?: { limit: number; delay: string | number; backoff?: 'constant' | 'linear' | 'exponential' };
  timeout?: string | number;
}

export interface StepRunner {
  do<T>(name: string, config: StepConfig, fn: () => Promise<T>): Promise<T>;
}

export interface RunnerIO {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  getText(key: string): Promise<string | null>;
  putText(key: string, text: string, contentType: string): Promise<void>;
  /** Model client, storage and budget hooks for one step. */
  deps(jobId: string, endUserId: string): SceneDeps;
  /** An error the step runner must not retry (NonRetryableError on Workers). */
  fatal(code: string): Error;
  hashUser(userId: string): Promise<string>;
  log(message: string): void;
}

export interface JobContext {
  job: { id: string; kind: 'story_start' | 'scene'; status: string; user_id: string };
  story: { id: string; premise: string; tags: string[]; mode: string; bible: StoryBible | null; arc: StoryArc | null; sheets: Record<string, string> | null };
  scene: { id: string; depth: number; chosen_choice: 'a' | 'b' | 'c' | null };
  path: { scene_id: string; title: string | null; manifest_key: string | null; chosen_choice: 'a' | 'b' | 'c' | null }[];
}

export const MAX_SCENES = 8;
export const PAID: StepConfig = { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' };
export const CHEAP: StepConfig = { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '1 minute' };

// Codes that are safe to store on the job (users can read ai_jobs.error_code). Anything else is logged
// and stored as generation_failed, so provider or database messages never reach the client.
const KNOWN_CODES = new Set(['job_budget_exceeded', 'daily_budget_exceeded', 'job_not_running', 'meta_not_configured', 'story_not_planned']);

/** Decide whether an error from a step should stop the job, and with which code. */
function stopCode(e: unknown): string | null {
  if (e instanceof BlockedError) return `blocked:${e.reason}`;
  if (e instanceof MetaApiError) return e.code === 'content_policy' ? 'blocked:provider_policy' : e.retryable ? null : 'generation_failed';
  if (e instanceof DbError) return KNOWN_CODES.has(e.message) ? e.message : null;
  return null;
}

/** The code stored on a failed job. */
export function publicCode(message: string): string {
  if (/^blocked:[a-z_]{1,40}$/.test(message)) return message;
  if (message.startsWith('blocked')) return 'blocked:policy';
  return KNOWN_CODES.has(message) ? message : 'generation_failed';
}

export async function runSceneJob(io: RunnerIO, step: StepRunner, jobId: string): Promise<'ready' | 'failed' | 'skipped'> {
  try {
    return await scene(io, step, jobId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = publicCode(message);
    if (code === 'generation_failed') io.log(`scene job ${jobId} failed: ${message.slice(0, 200)}`);
    await step.do('fail', CHEAP, async () => {
      await io.rpc('ai_job_failed', { p_job: jobId, p_error_code: code, p_blocked: code.startsWith('blocked:') });
      return true;
    });
    return 'failed';
  }
}

async function scene(io: RunnerIO, step: StepRunner, jobId: string): Promise<'ready' | 'skipped'> {
  const guarded = <T>(fn: () => Promise<T>) => async (): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      const code = stopCode(e);
      throw code ? io.fatal(code) : e;
    }
  };

  const ctx = await step.do('context', CHEAP, () => io.rpc<JobContext>('ai_job_context', { p_job: jobId }));
  if (ctx.job.status === 'succeeded' || ctx.job.status === 'failed') return 'skipped';
  // The provider sees a stable pseudonym, never our user id.
  const endUser = await io.hashUser(ctx.job.user_id);
  const deps = () => io.deps(jobId, endUser);
  const progress = (p: string) => step.do(`progress:${p}`, CHEAP, async () => {
    await io.rpc('ai_progress', { p_job: jobId, p_progress: p });
    return true;
  });

  const isStart = ctx.job.kind === 'story_start';
  let bible = ctx.story.bible;
  let arc = ctx.story.arc;
  let sheets = ctx.story.sheets ?? {};
  if (isStart) {
    await progress('planning');
    const plan = await step.do('plan', PAID, guarded(() =>
      planStory(deps(), { premise: ctx.story.premise, tags: ctx.story.tags, maxScenes: MAX_SCENES })));
    bible = plan.bible;
    arc = plan.arc;
    await progress('casting');
    sheets = await step.do('sheets', PAID, guarded(() => drawCharacterSheets(deps(), ctx.story.id, plan.bible)));
  }
  if (!bible || !arc) throw io.fatal('story_not_planned');
  const b = bible;
  const a = arc;

  // The story so far, from the manifests of the scenes on this path, with the choice taken after each.
  const history = await step.do('history', CHEAP, async () => {
    const out: { title: string; narration: string; choice: string | null }[] = [];
    for (let i = 0; i < ctx.path.length; i++) {
      const key = ctx.path[i]!.manifest_key;
      const text = key ? await io.getText(key) : null;
      if (!text) continue;
      const m = JSON.parse(text) as StoryManifest;
      const next = i + 1 < ctx.path.length ? ctx.path[i + 1]!.chosen_choice : ctx.scene.chosen_choice;
      out.push({ title: m.title, narration: m.narration.text, choice: m.choices.find((c) => c.id === next)?.label ?? null });
    }
    return out;
  });
  const choiceLabel = ctx.scene.chosen_choice ? history.at(-1)?.choice ?? null : null;

  await progress('writing');
  const script: SceneScript = await step.do('script', PAID, guarded(() => writeScene(deps(), {
    bible: b, arc: a, history, choice: choiceLabel, sceneNumber: ctx.scene.depth, maxScenes: MAX_SCENES,
  })));

  await progress('drawing');
  const parent = ctx.path.at(-1);
  const previous = parent ? keys.panel(ctx.story.id, parent.scene_id, 4) : null;
  const draw = (n: number, prev: string | null, redraw = false) =>
    step.do(`${redraw ? 'redraw' : 'panel'}:${n}`, PAID, guarded(() => drawPanel(deps(), {
      storyId: ctx.story.id, sceneId: ctx.scene.id, bible: b, script, n, sheets, previousPanelKey: prev, redraw,
    })));
  const p1 = await draw(1, previous);
  const panelKeys = [p1, ...(await Promise.all([2, 3, 4].map((n) => draw(n, p1))))];

  await progress('checking');
  const check = await step.do('check', PAID, guarded(() => checkPanels(deps(), b, script, panelKeys)));
  const outcome = checkOutcome(check);
  if (outcome.action === 'block') throw io.fatal(`blocked:${outcome.reason}`);
  if (outcome.action === 'redraw') {
    // One redraw of the flagged panels (same keys, so the manifest doesn't change), no second check.
    // Panel 1 first, because the others are anchored on it.
    if (outcome.panels.includes(1)) await draw(1, previous, true);
    await Promise.all(outcome.panels.filter((n) => n !== 1).map((n) => draw(n, p1, true)));
  }

  await progress('framing');
  const focus: (FocusBox | null)[] = await Promise.all(script.panels.map((p, i) =>
    step.do(`focus:${p.n}`, CHEAP, () => focusBox(deps(), p.n, p.focus_subject, panelKeys[i]!))));

  const manifestKey = await step.do('manifest', CHEAP, async () => {
    const m = buildManifest({
      storyId: ctx.story.id, sceneId: ctx.scene.id, bible: b, script, panelKeys,
      plates: [null, null, null, null],  // two-layer parallax plates: stretch (cost), off for now
      focus, narrationAudioKey: null, captionsKey: null, durationMs: null,
      models: [
        ...(isStart ? [{ task: 'plan', provider: 'meta', model: 'muse-wonder-1.0' }, { task: 'sheets', provider: 'meta', model: 'muse-image-1.0' }] : []),
        { task: 'script', provider: 'meta', model: 'muse-spark-1.3' },
        { task: 'panels', provider: 'meta', model: 'muse-image-1.0' },
        { task: 'check', provider: 'meta', model: 'muse-spark-1.3' },
        { task: 'focus', provider: 'meta', model: 'sam-3.1' },
      ],
      now: new Date(),
    });
    const key = keys.manifest(ctx.story.id, ctx.scene.id);
    await io.putText(key, JSON.stringify(m), 'application/json');
    return key;
  });

  await step.do('ready', CHEAP, async () => {
    await io.rpc('ai_scene_ready', {
      p_job: jobId, p_title: script.scene_title, p_is_ending: script.is_ending, p_manifest_key: manifestKey,
      p_bible: isStart ? b : null, p_arc: isStart ? a : null, p_sheets: isStart ? sheets : null,
    });
    return true;
  });
  return 'ready';
}

