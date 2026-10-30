// The AI story pipeline as plain functions with injected dependencies. The Cloudflare Workflow
// (workflows/story-scene.ts) runs each paid call as its own durable step; tests run the same
// functions with fakes. Every paid call reserves budget first and is logged for the AI Act audit
// trail and the "How this scene was made" sheet.

import {
  assertCharacterAges, PanelCheckSchema, PROMPT_VERSION, SceneScriptSchema, StoryArcSchema, StoryBibleSchema,
  TextVerdictSchema, type FocusBox, type PanelCheck, type SceneScript, type StoryArc, type StoryBible,
  type StoryManifest, type TextVerdict,
} from '@reeltale/shared';
import { z } from 'zod';
import type { MetaClient, SamBox } from './meta.ts';
import {
  characterSheetPrompt, cleanPlatePrompt, panelCheckPrompt, panelImagePrompt, planPrompt, scenePrompt,
  textModerationPrompt, fenceText, type ModeratedText,
} from './prompts.ts';

// Rough list prices in USD micros, used to reserve budget before a call (actual cost is logged after).
export const COST = {
  wonderPlan: 60_000,
  sparkScene: 15_000,
  sparkCheck: 10_000,
  sparkModeration: 3_000,
  image: 10_000,
  samImage: 2_500,
} as const;

export interface GenerationLog {
  task: string;
  provider: 'meta';
  model: string;
  cost_micros: number;
  latency_ms: number;
  ok: boolean;
  error_code?: string;
  output_key?: string;
}

export interface SceneDeps {
  meta: MetaClient;
  /** Write bytes to private storage (R2 AI_ASSETS). Keys are deterministic, so retries overwrite. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Read stored bytes back (to send images to the model as data URLs). */
  get(key: string): Promise<Uint8Array>;
  /** Reserve budget for one paid call; throws when the job or the daily budget is exhausted. */
  reserve(step: string, estMicros: number): Promise<void>;
  log(entry: GenerationLog): Promise<void>;
  now(): Date;
}

export class BlockedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`blocked: ${reason}`);
    this.reason = reason;
  }
}

async function timed<T>(deps: SceneDeps, task: string, model: string, cost: number, fn: () => Promise<T>, outputKey?: string): Promise<T> {
  await deps.reserve(task, cost);
  const start = deps.now().getTime();
  try {
    const out = await fn();
    await deps.log({ task, provider: 'meta', model, cost_micros: cost, latency_ms: deps.now().getTime() - start, ok: true, output_key: outputKey });
    return out;
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'error';
    await deps.log({ task, provider: 'meta', model, cost_micros: cost, latency_ms: deps.now().getTime() - start, ok: false, error_code: code });
    throw e;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function dataUrl(deps: SceneDeps, key: string, type = 'image/webp'): Promise<string> {
  return `data:${type};base64,${toBase64(await deps.get(key))}`;
}

export const keys = {
  sheet: (story: string, character: string) => `ai/${story}/sheets/${character}.webp`,
  panel: (story: string, scene: string, n: number) => `ai/${story}/${scene}/panel-${n}.webp`,
  plate: (story: string, scene: string, n: number) => `ai/${story}/${scene}/plate-${n}.webp`,
  manifest: (story: string, scene: string) => `ai/${story}/${scene}/manifest.json`,
};

// ---- Moderation ------------------------------------------------------------------------------------

/** Moderate user text with Muse Spark. "review" counts as blocked for generation (fail closed). */
export async function moderateText(deps: SceneDeps, kind: ModeratedText, text: string): Promise<TextVerdict> {
  const clipped = text.slice(0, 2000);
  const { data } = await timed(deps, `moderate:${kind}`, 'muse-spark-1.3', COST.sparkModeration, () =>
    deps.meta.chatJson({
      model: 'muse-spark-1.3', schemaName: 'text_verdict', schema: TextVerdictSchema, effort: 'low',
      system: textModerationPrompt(kind),
      user: fenceText(clipped),
    }));
  return data;
}

// ---- Planning ----------------------------------------------------------------------------------------

const PlanSchema = z.object({ bible: StoryBibleSchema, arc: StoryArcSchema });

export async function planStory(deps: SceneDeps, input: { premise: string; tags: string[]; maxScenes: number }) {
  const verdict = await moderateText(deps, 'premise', input.premise);
  if (verdict.decision !== 'allow') throw new BlockedError(verdict.categories.join(',') || 'premise');
  const p = planPrompt(input);
  const { data } = await timed(deps, 'plan', 'muse-wonder-1.0', COST.wonderPlan, () =>
    deps.meta.chatJson({ model: 'muse-wonder-1.0', schemaName: 'story_plan', schema: PlanSchema, effort: 'medium', system: p.system, user: p.user }));
  assertCharacterAges(data.bible, input.tags);
  return data as { bible: StoryBible; arc: StoryArc };
}

export async function drawCharacterSheets(deps: SceneDeps, storyId: string, bible: StoryBible): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of bible.characters) {
    const key = keys.sheet(storyId, c.id);
    const bytes = await timed(deps, `sheet:${c.id}`, 'muse-image-1.0', COST.image,
      () => deps.meta.generateImage({ prompt: characterSheetPrompt(bible, c.id), size: '1536x1024' }), key);
    await deps.put(key, bytes, 'image/webp');
    out[c.id] = key;
  }
  return out;
}

// ---- One scene ---------------------------------------------------------------------------------------

export async function writeScene(deps: SceneDeps, input: Parameters<typeof scenePrompt>[0]): Promise<SceneScript> {
  const p = scenePrompt(input);
  const { data } = await timed(deps, 'script', 'muse-spark-1.3', COST.sparkScene, () =>
    deps.meta.chatJson({ model: 'muse-spark-1.3', schemaName: 'scene_script', schema: SceneScriptSchema, effort: 'low', system: p.system, user: p.user }));
  return data;
}

/**
 * Draw one panel as an edit anchored on the sheets of the characters in it (and the previous panel for
 * continuity), so faces and outfits stay consistent. Panels without characters are generated fresh.
 */
export async function drawPanel(deps: SceneDeps, args: {
  storyId: string; sceneId: string; bible: StoryBible; script: SceneScript; n: number;
  sheets: Record<string, string>; previousPanelKey: string | null;
  /** Set for a redraw after the check, so it reserves its own budget instead of reusing the first draw's. */
  redraw?: boolean;
}): Promise<string> {
  const panel = args.script.panels.find((p) => p.n === args.n);
  if (!panel) throw new Error(`no panel ${args.n}`);
  const key = keys.panel(args.storyId, args.sceneId, args.n);
  const prompt = panelImagePrompt(args.bible, panel);
  const refs = panel.characters_present.map((id) => args.sheets[id]).filter((k): k is string => Boolean(k));
  if (args.previousPanelKey) refs.push(args.previousPanelKey);
  const bytes = await timed(deps, `panel:${args.n}${args.redraw ? ':redraw' : ''}`, 'muse-image-1.0', COST.image, async () => {
    if (refs.length === 0) return deps.meta.generateImage({ prompt, size: '1080x1920', fast: true });
    const images = await Promise.all(refs.slice(0, 10).map((k) => dataUrl(deps, k)));
    return deps.meta.editImage({ prompt, images, size: '1080x1920', fast: true });
  }, key);
  await deps.put(key, bytes, 'image/webp');
  return key;
}

/** A background plate without the characters, for two-layer parallax. Optional: failures return null. */
export async function drawCleanPlate(deps: SceneDeps, args: { storyId: string; sceneId: string; n: number; panelKey: string }): Promise<string | null> {
  const key = keys.plate(args.storyId, args.sceneId, args.n);
  try {
    const bytes = await timed(deps, `plate:${args.n}`, 'muse-image-1.0', COST.image,
      async () => deps.meta.editImage({ prompt: cleanPlatePrompt(), images: [await dataUrl(deps, args.panelKey)], size: '1080x1920', fast: true }), key);
    await deps.put(key, bytes, 'image/webp');
    return key;
  } catch {
    return null;
  }
}

/** Muse Spark looks at all four panels for safety and consistency problems. */
export async function checkPanels(deps: SceneDeps, bible: StoryBible, script: SceneScript, panelKeys: string[]): Promise<PanelCheck> {
  const p = panelCheckPrompt(bible, script);
  const images = await Promise.all(panelKeys.map((k) => dataUrl(deps, k)));
  const { data } = await timed(deps, 'check', 'muse-spark-1.3', COST.sparkCheck, () =>
    deps.meta.chatJson({
      model: 'muse-spark-1.3', schemaName: 'panel_check', schema: PanelCheckSchema, effort: 'low', system: p.system,
      user: [{ type: 'text', text: p.text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))],
    }));
  return data;
}

/** What the check means for the scene: deliver, redraw some panels once, or refuse (refund). */
export function checkOutcome(check: PanelCheck): { action: 'ok' } | { action: 'redraw'; panels: number[] } | { action: 'block'; reason: string } {
  const block = check.issues.find((i) => i.severity === 'block');
  if (block) return { action: 'block', reason: block.category };
  const redraw = [...new Set(check.issues.filter((i) => i.severity === 'regenerate').map((i) => i.panel))].sort();
  return redraw.length ? { action: 'redraw', panels: redraw } : { action: 'ok' };
}

/** SAM 3.1 box of each panel's focus subject, normalised to 0..1 (Ken Burns focus, caption placement). */
export async function focusBox(deps: SceneDeps, n: number, phrase: string, panelKey: string): Promise<FocusBox | null> {
  let boxes: SamBox[] = [];
  try {
    boxes = await timed(deps, `sam:${n}`, 'sam-3.1', COST.samImage, async () =>
      deps.meta.segmentBoxes({ phrase, imageUrl: await dataUrl(deps, panelKey) }));
  } catch {
    return null;
  }
  const b = boxes.sort((a, z2) => (z2.x2 - z2.x1) * (z2.y2 - z2.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))[0];
  if (!b) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(b.x1 / b.w), y: clamp(b.y1 / b.h), w: clamp((b.x2 - b.x1 + 1) / b.w), h: clamp((b.y2 - b.y1 + 1) / b.h) };
}

export function buildManifest(args: {
  storyId: string; sceneId: string; bible: StoryBible; script: SceneScript; panelKeys: string[];
  plates: (string | null)[]; focus: (FocusBox | null)[]; narrationAudioKey: string | null; captionsKey: string | null;
  durationMs: number | null; models: StoryManifest['provenance']['models']; now: Date;
}): StoryManifest {
  const name = (id: string) => args.bible.characters.find((c) => c.id === id)?.name ?? id;
  return {
    version: 1,
    story_id: args.storyId,
    scene_id: args.sceneId,
    title: args.script.scene_title,
    panels: args.script.panels.map((p, i) => ({
      n: p.n,
      image: args.panelKeys[i] ?? '',
      plate: args.plates[i] ?? null,
      focus: args.focus[i] ?? null,
      caption: p.caption,
      dialogue: p.dialogue.map((d) => ({ name: name(d.character_id), line: d.line })),
    })),
    narration: { text: args.script.narration, audio: args.narrationAudioKey, captions_vtt: args.captionsKey, duration_ms: args.durationMs },
    choices: args.script.is_ending ? [] : args.script.choices,
    is_ending: args.script.is_ending,
    provenance: {
      ai_generated: true,
      prompt_version: PROMPT_VERSION,
      created_at: args.now.toISOString(),
      models: args.models,
      c2pa_signed: false,
    },
  };
}
