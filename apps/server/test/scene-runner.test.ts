import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SceneScript, StoryBible } from '@reeltale/shared';
import { DbError } from '../src/lib/db.ts';
import { MetaApiError, type MetaClient } from '../src/ai/meta.ts';
import { publicCode, runSceneJob, type JobContext, type RunnerIO, type StepRunner } from '../src/workflows/scene-runner.ts';

const STORY = '11111111-1111-4111-8111-111111111111';
const SCENE = '22222222-2222-4222-8222-222222222222';
const PARENT = '33333333-3333-4333-8333-333333333333';
const JOB = '44444444-4444-4444-8444-444444444444';

const bible: StoryBible = {
  title: 'The Lighthouse Letters', logline: 'Letters from the future.', genre: 'Mystery', tone: 'eerie', setting: 'island',
  style_guide: 'Ink and watercolor.', content_rating: 'general', rules: [],
  characters: [{ id: 'mara', name: 'Mara', age: 34, role: 'keeper', look: 'auburn braid', outfit: 'navy coat', voice: 'low' }],
};
const arc = { premise_summary: 'p', ending_options: ['a', 'b'], beats: [] };
const script: SceneScript = {
  scene_title: 'Low Tide', narration: 'The tide pulled back.', is_ending: false,
  panels: [1, 2, 3, 4].map((n) => ({ n, shot: 'medium' as const, visual: `Panel ${n}`, focus_subject: 'the envelope',
    characters_present: n === 4 ? [] : ['mara'], caption: '', dialogue: [] })),
  choices: [{ id: 'a', label: 'Open it', hint: '' }, { id: 'b', label: 'Hide it', hint: '' }, { id: 'c', label: 'Burn it', hint: '' }],
  continuity: { new_facts: [], character_changes: [] },
};

const startCtx = (): JobContext => ({
  job: { id: JOB, kind: 'story_start', status: 'queued', user_id: 'user-1' },
  story: { id: STORY, premise: 'A lighthouse keeper finds letters.', tags: ['mystery'], mode: 'comic', bible: null, arc: null, sheets: {} },
  scene: { id: SCENE, depth: 1, chosen_choice: null },
  path: [],
});

class Fatal extends Error {}

/** Runs steps like Workflows does: memoised by name, retried up to the limit unless the error is fatal. */
function steps() {
  const done = new Map<string, unknown>();
  const ran: string[] = [];
  const runner: StepRunner = {
    async do(name, config, fn) {
      if (done.has(name)) return done.get(name) as never;
      ran.push(name);
      let last: unknown;
      for (let i = 0; i <= (config.retries?.limit ?? 0); i++) {
        try {
          const v = await fn();
          done.set(name, v);
          return v;
        } catch (e) {
          last = e;
          if (e instanceof Fatal) break;
        }
      }
      throw last;
    },
  };
  return { runner, ran };
}

function fakeMeta(over: Partial<MetaClient> = {}) {
  const prompts: Record<string, string[]> = {};
  const edits: string[][] = [];
  const meta = {
    async chatJson(args: { schemaName: string; user: unknown }) {
      (prompts[args.schemaName] ??= []).push(typeof args.user === 'string' ? args.user : JSON.stringify(args.user));
      const data = {
        text_verdict: { decision: 'allow', categories: [], reason: '' },
        story_plan: { bible, arc },
        scene_script: script,
        panel_check: { issues: [] },
      }[args.schemaName];
      return { data, usage: {} };
    },
    async generateImage() { return new Uint8Array([1]); },
    async editImage(args: { images: string[] }) { edits.push(args.images); return new Uint8Array([2]); },
    async segmentBoxes() { return [{ x1: 0, y1: 0, x2: 49, y2: 49, w: 100, h: 100 }]; },
    ...over,
  } as unknown as MetaClient;
  return { meta, prompts, edits };
}

function harness(ctx: JobContext, meta: MetaClient, opts: { reserve?: (step: string) => void } = {}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const text = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const reserved: string[] = [];
  const logged: string[] = [];
  const io: RunnerIO = {
    async rpc(fn, args) {
      rpcs.push({ fn, args });
      return (fn === 'ai_job_context' ? ctx : null) as never;
    },
    async getText(k) { return text.get(k) ?? null; },
    async putText(k, t) { text.set(k, t); },
    deps: () => ({
      meta,
      async put(k, b) { bytes.set(k, b); },
      async get(k) { const v = bytes.get(k); if (!v) throw new Error(`missing ${k}`); return v; },
      async reserve(s) { opts.reserve?.(s); reserved.push(s); },
      async log() {},
      now: () => new Date('2026-10-27T12:00:00Z'),
    }),
    fatal: (code) => new Fatal(code),
    hashUser: async () => 'pseudonym',
    log: (m) => logged.push(m),
  };
  const last = (fn: string) => rpcs.filter((r) => r.fn === fn).at(-1)?.args;
  return { io, rpcs, text, bytes, reserved, logged, last };
}

test('a first scene plans, casts, draws, checks, frames and is delivered', async () => {
  const { meta } = fakeMeta();
  const h = harness(startCtx(), meta);
  const s = steps();
  assert.equal(await runSceneJob(h.io, s.runner, JOB), 'ready');
  assert.equal(new Set(s.ran).size, s.ran.length, 'step names are unique');
  assert.equal(new Set(h.reserved).size, h.reserved.length, 'every paid call reserves under its own name');
  for (const r of ['plan', 'script', 'panel:1', 'panel:4', 'check', 'sam:1', 'sam:4']) assert.ok(h.reserved.includes(r), r);
  const ready = h.last('ai_scene_ready')!;
  assert.equal(ready.p_manifest_key, `ai/${STORY}/${SCENE}/manifest.json`);
  assert.deepEqual(ready.p_bible, bible, 'a first scene stores the plan');
  assert.ok(ready.p_sheets && Object.keys(ready.p_sheets as object).includes('mara'));
  const manifest = JSON.parse(h.text.get(`ai/${STORY}/${SCENE}/manifest.json`)!);
  assert.equal(manifest.provenance.ai_generated, true);
  assert.equal(manifest.panels.length, 4);
  assert.equal(h.last('ai_job_failed'), undefined);
});

test('a continuation sees the story so far and the choice, and anchors on the previous panel', async () => {
  const { meta, prompts, edits } = fakeMeta();
  const ctx: JobContext = {
    ...startCtx(),
    job: { id: JOB, kind: 'scene', status: 'queued', user_id: 'user-1' },
    story: { ...startCtx().story, bible, arc, sheets: { mara: `ai/${STORY}/sheets/mara.webp` } },
    scene: { id: SCENE, depth: 2, chosen_choice: 'b' },
    path: [{ scene_id: PARENT, title: 'Low Tide', manifest_key: `ai/${STORY}/${PARENT}/manifest.json`, chosen_choice: null }],
  };
  const h = harness(ctx, meta);
  h.text.set(`ai/${STORY}/${PARENT}/manifest.json`, JSON.stringify({ title: 'Low Tide', narration: { text: 'The tide pulled back.' }, choices: script.choices }));
  h.bytes.set(`ai/${STORY}/sheets/mara.webp`, new Uint8Array([7]));
  h.bytes.set(`ai/${STORY}/${PARENT}/panel-4.webp`, new Uint8Array([8]));
  assert.equal(await runSceneJob(h.io, steps().runner, JOB), 'ready');
  const user = prompts.scene_script?.[0] ?? '';
  assert.match(user, /The reader chose: "Hide it"\. Write scene 2\./);
  assert.match(user, /The tide pulled back/);
  assert.equal(prompts.story_plan, undefined, 'no re-planning');
  assert.equal(edits[0]?.length, 2, 'panel 1 = sheet + previous scene\'s last panel');
  assert.equal(h.last('ai_scene_ready')!.p_bible, null);
});

test('a blocking check fails the job as blocked, without retrying the check', async () => {
  const { meta, prompts } = fakeMeta();
  const base = meta.chatJson.bind(meta);
  meta.chatJson = (async (args: Parameters<MetaClient['chatJson']>[0]) => args.schemaName === 'panel_check'
    ? (prompts.panel_check = [...(prompts.panel_check ?? []), 'x'], { data: { issues: [{ panel: 2, category: 'apparent_minor', severity: 'block', detail: '' }] }, usage: {} })
    : base(args)) as MetaClient['chatJson'];
  const h = harness(startCtx(), meta);
  assert.equal(await runSceneJob(h.io, steps().runner, JOB), 'failed');
  assert.deepEqual(h.last('ai_job_failed'), { p_job: JOB, p_error_code: 'blocked:apparent_minor', p_blocked: true });
  assert.equal(h.last('ai_scene_ready'), undefined);
  assert.equal(prompts.panel_check?.length, 1);
});

test('flagged panels are redrawn once, each redraw reserving its own budget', async () => {
  const { meta } = fakeMeta();
  const base = meta.chatJson.bind(meta);
  meta.chatJson = (async (args: Parameters<MetaClient['chatJson']>[0]) => args.schemaName === 'panel_check'
    ? { data: { issues: [{ panel: 3, category: 'consistency', severity: 'regenerate', detail: '' }] }, usage: {} }
    : base(args)) as MetaClient['chatJson'];
  const h = harness(startCtx(), meta);
  assert.equal(await runSceneJob(h.io, steps().runner, JOB), 'ready');
  assert.ok(h.reserved.includes('panel:3:redraw'));
  assert.ok(!h.reserved.includes('panel:2:redraw'));
});

test('transient provider errors are retried; a provider content block is not', async () => {
  let calls = 0;
  const flaky = fakeMeta({
    async generateImage() {
      calls++;
      if (calls === 1) throw new MetaApiError(503, 'unavailable', 'try later', true);
      return new Uint8Array([1]);
    },
  });
  const h1 = harness(startCtx(), flaky.meta);
  assert.equal(await runSceneJob(h1.io, steps().runner, JOB), 'ready');

  let blockedCalls = 0;
  const blocked = fakeMeta({
    async generateImage() { blockedCalls++; throw new MetaApiError(400, 'content_policy', 'blocked', false); },
  });
  const h2 = harness(startCtx(), blocked.meta);
  assert.equal(await runSceneJob(h2.io, steps().runner, JOB), 'failed');
  assert.equal(blockedCalls, 1, 'not retried');
  assert.deepEqual(h2.last('ai_job_failed'), { p_job: JOB, p_error_code: 'blocked:provider_policy', p_blocked: true });
});

test('budget stops are final; unknown errors are stored as generation_failed and only logged in full', async () => {
  const { meta, prompts } = fakeMeta();
  const h = harness(startCtx(), meta, { reserve: (s) => { if (s === 'script') throw new DbError(400, 'job_budget_exceeded', '54000'); } });
  assert.equal(await runSceneJob(h.io, steps().runner, JOB), 'failed');
  assert.equal(h.last('ai_job_failed')!.p_error_code, 'job_budget_exceeded');
  assert.equal(prompts.scene_script, undefined, 'the model is never called past the budget');

  const broken = fakeMeta({ async generateImage() { throw new Error('connect ECONNRESET 10.0.0.3:443'); } });
  const h2 = harness(startCtx(), broken.meta);
  assert.equal(await runSceneJob(h2.io, steps().runner, JOB), 'failed');
  assert.deepEqual(h2.last('ai_job_failed'), { p_job: JOB, p_error_code: 'generation_failed', p_blocked: false });
  assert.match(h2.logged.join('\n'), /ECONNRESET/);
});

test('a job that already finished is skipped without any model call', async () => {
  const { meta, prompts } = fakeMeta();
  const h = harness({ ...startCtx(), job: { ...startCtx().job, status: 'succeeded' } }, meta);
  assert.equal(await runSceneJob(h.io, steps().runner, JOB), 'skipped');
  assert.deepEqual(prompts, {});
  assert.deepEqual(h.rpcs.map((r) => r.fn), ['ai_job_context']);
});

test('only known codes reach the job row', () => {
  assert.equal(publicCode('blocked:sexual'), 'blocked:sexual');
  assert.equal(publicCode('blocked: weird <b>'), 'blocked:policy');
  assert.equal(publicCode('daily_budget_exceeded'), 'daily_budget_exceeded');
  assert.equal(publicCode('duplicate key value violates unique constraint "x"'), 'generation_failed');
});
