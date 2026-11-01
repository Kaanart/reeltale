// Demo mode's stand-in for the Worker and the AI tables: stories, scenes and jobs held in one value, with
// jobs that move through the real progress steps on a clock. Pure (every function takes `now`, and ids
// come from the caller), so node tests drive it (src/core/__tests__/story-demo.test.ts). The hooks keep
// the state in a demoState cell and read it at Date.now(). Nothing here touches the network.
//
// Like the server: a start or a new choice costs coins (the caller takes them from the demo wallet), the
// same request id or the same choice twice returns what exists, a blocked path is not charged (the real
// one is refunded), and only one scene of a story is made at a time.

import type { StoryManifest } from '@reeltale/shared';
import { ApiError, type ChoiceId, type Started } from '../../core/api.ts';
import { stepsFor } from '../../core/jobs.ts';
import { DEMO_USER_ID } from '../../demo/fixtures.ts';
import { sceneToOpen } from './logic.ts';
import { buildDemoManifest, demoAiStory, demoFixtureScenes, demoTemplate } from './demo.ts';
import type { AiJobRow, AiSceneRow, AiStoryRow } from './types.ts';

export interface DemoJob {
  id: string;
  kind: 'story_start' | 'scene';
  startedAt: number;
  outcome: 'ready' | 'blocked' | 'failed';
}

export interface DemoScene {
  /** The row as created. For a scene with a job, the status shown is worked out from the job (demoSceneRow). */
  row: AiSceneRow;
  /** The choices that lead here: '' is the opening, 'ab' is choice a then b. */
  path: string;
  job: DemoJob | null;
}

export interface DemoStory {
  story: AiStoryRow;
  requestId: string | null;
  scenes: DemoScene[];
  /** Started in this demo session: it plays the sample scenes whatever the opening said. */
  sample: boolean;
}

export interface DemoStoryState {
  stories: DemoStory[];
}

/** How long a demo job waits in the queue, then spends on each progress step. */
export const DEMO_QUEUED_MS = 400;
export const DEMO_STEP_MS = 1200;

const workSteps = (kind: DemoJob['kind']) => stepsFor(kind).filter((s) => s !== 'ready');

export function demoJobDuration(kind: DemoJob['kind']): number {
  return DEMO_QUEUED_MS + workSteps(kind).length * DEMO_STEP_MS;
}

/** The demo's starting point: the fixture story with its first scene read, one path drawn and one blocked. */
export function initialDemoStories(): DemoStoryState {
  return {
    stories: [{
      story: demoAiStory,
      requestId: null,
      scenes: demoFixtureScenes.map((s) => ({ row: s.row, path: s.path, job: null })),
      sample: false,
    }],
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

// ---- Reading --------------------------------------------------------------------------------------------

/** The job row as public.ai_jobs would show it at `now`, or null for a fixture scene that has none. */
export function demoJobRow(story: DemoStory, scene: DemoScene, now: number): AiJobRow | null {
  const job = scene.job;
  if (!job) return null;
  const elapsed = Math.max(0, now - job.startedAt);
  const base = {
    id: job.id, story_id: story.story.id, scene_id: scene.row.id, kind: job.kind, lane: 'scene' as const,
    created_at: iso(job.startedAt),
  };
  if (elapsed < DEMO_QUEUED_MS) return { ...base, status: 'queued', progress: null, error_code: null, finished_at: null };
  const steps = workSteps(job.kind);
  if (elapsed < demoJobDuration(job.kind)) {
    const step = steps[Math.min(steps.length - 1, Math.floor((elapsed - DEMO_QUEUED_MS) / DEMO_STEP_MS))] ?? null;
    return { ...base, status: 'running', progress: step, error_code: null, finished_at: null };
  }
  const finished_at = iso(job.startedAt + demoJobDuration(job.kind));
  if (job.outcome === 'ready') return { ...base, status: 'succeeded', progress: 'ready', error_code: null, finished_at };
  const error_code = job.outcome === 'blocked' ? 'blocked:demo' : 'generation_failed';
  return { ...base, status: 'failed', progress: steps.at(-1) ?? null, error_code, finished_at };
}

/** The scene row as public.ai_scenes would show it at `now`. */
export function demoSceneRow(story: DemoStory, scene: DemoScene, now: number): AiSceneRow {
  const job = demoJobRow(story, scene, now);
  if (!job) return scene.row;
  const tpl = demoTemplate(scene.path);
  if (job.status === 'queued') return { ...scene.row, status: 'queued' };
  if (job.status === 'running') return { ...scene.row, status: 'generating' };
  if (job.status === 'succeeded' && tpl && tpl !== 'blocked') {
    return { ...scene.row, status: 'ready', title: tpl.title, is_ending: tpl.isEnding };
  }
  return { ...scene.row, status: job.error_code?.startsWith('blocked') ? 'blocked' : 'failed' };
}

/**
 * The story row at `now`: its status follows the opening scene, and an ending reached completes it. A sample
 * story keeps no title (the list shows its opening), so it never looks like a second copy of the fixture.
 */
export function demoStoryRow(story: DemoStory, now: number): AiStoryRow {
  const rows = story.scenes.map((s) => demoSceneRow(story, s, now));
  const root = rows.find((r) => r.parent_scene_id === null);
  let status: AiStoryRow['status'] = 'planning';
  if (root?.status === 'blocked') status = 'blocked';
  else if (root?.status === 'failed') status = 'failed';
  else if (root?.status === 'ready') status = rows.some((r) => r.status === 'ready' && r.is_ending) ? 'completed' : 'active';
  const latest = story.scenes.reduce((ms, s) => Math.max(ms, Date.parse(s.row.created_at) || 0), Date.parse(story.story.updated_at) || 0);
  return { ...story.story, status, updated_at: iso(latest) };
}

function findStory(state: DemoStoryState, storyId: string): DemoStory {
  const story = state.stories.find((s) => s.story.id === storyId);
  if (!story) throw new ApiError(404, 'not_found');
  return story;
}

function findScene(state: DemoStoryState, sceneId: string): { story: DemoStory; scene: DemoScene } {
  for (const story of state.stories) {
    const scene = story.scenes.find((s) => s.row.id === sceneId);
    if (scene) return { story, scene };
  }
  throw new ApiError(404, 'scene_not_found');
}

/** The reader's stories, most recently changed first. */
export function demoStoryList(state: DemoStoryState, now: number): AiStoryRow[] {
  return state.stories.map((s) => demoStoryRow(s, now)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function demoStoryById(state: DemoStoryState, storyId: string, now: number): AiStoryRow {
  return demoStoryRow(findStory(state, storyId), now);
}

/** True for a story started in this demo session (it plays the sample scenes). */
export function demoIsSample(state: DemoStoryState, storyId: string): boolean {
  return state.stories.find((s) => s.story.id === storyId)?.sample ?? false;
}

/** The scene to open when a story is opened without one (logic.ts sceneToOpen). */
export function demoLatestSceneId(state: DemoStoryState, storyId: string, now: number): string | null {
  const story = findStory(state, storyId);
  return sceneToOpen(story.scenes.map((s) => demoSceneRow(story, s, now)));
}

/** A scene and its latest job, as the player polls them. */
export function demoSceneState(state: DemoStoryState, sceneId: string, now: number): { scene: AiSceneRow; job: AiJobRow | null } {
  const { story, scene } = findScene(state, sceneId);
  return { scene: demoSceneRow(story, scene, now), job: demoJobRow(story, scene, now) };
}

/** The scenes already made from a scene's choices. */
export function demoChildren(state: DemoStoryState, sceneId: string, now: number): AiSceneRow[] {
  const { story } = findScene(state, sceneId);
  return story.scenes.filter((s) => s.row.parent_scene_id === sceneId).map((s) => demoSceneRow(story, s, now));
}

/** The manifest of a finished scene; like the Worker, `not_available` until it is ready. */
export function demoManifestFor(state: DemoStoryState, sceneId: string, now: number): StoryManifest {
  const { story, scene } = findScene(state, sceneId);
  const row = demoSceneRow(story, scene, now);
  const manifest = row.status === 'ready'
    ? buildDemoManifest(story.story.id, scene.row.id, scene.path, scene.job ? iso(scene.job.startedAt) : row.created_at)
    : null;
  if (!manifest) throw new ApiError(404, 'not_available');
  return manifest;
}

// ---- Changing -------------------------------------------------------------------------------------------

export interface DemoResult {
  state: DemoStoryState;
  started: Started;
  /** Coins to take from the demo wallet (0 for an existing story or scene, and for a path that will be blocked). */
  charged: number;
}

/** POST /api/ai/stories. The same request id returns the same story. */
export function demoStart(
  state: DemoStoryState,
  input: { premise: string; tags: readonly string[]; requestId: string; price: number },
  now: number,
  newId: () => string,
): DemoResult {
  const again = state.stories.find((s) => s.requestId === input.requestId);
  if (again) {
    const root = again.scenes.find((s) => s.row.parent_scene_id === null);
    if (!root) throw new ApiError(404, 'not_found');
    return {
      state,
      started: { story_id: again.story.id, scene_id: root.row.id, job_id: root.job?.id ?? newId(), existing: true },
      charged: 0,
    };
  }
  const storyId = newId();
  const sceneId = newId();
  const jobId = newId();
  const at = iso(now);
  const story: DemoStory = {
    story: {
      id: storyId, owner_id: DEMO_USER_ID, premise: input.premise.trim(), tags: [...input.tags], mode: 'comic', title: null,
      status: 'planning', visibility: 'private', published_series_id: null, created_at: at, updated_at: at,
    },
    requestId: input.requestId,
    scenes: [{
      row: {
        id: sceneId, story_id: storyId, parent_scene_id: null, chosen_choice: null, depth: 1, status: 'queued',
        title: null, is_ending: false, created_at: at,
      },
      path: '',
      job: { id: jobId, kind: 'story_start', startedAt: now, outcome: 'ready' },
    }],
    sample: true,
  };
  return {
    state: { stories: [story, ...state.stories] },
    started: { story_id: storyId, scene_id: sceneId, job_id: jobId, existing: false },
    charged: input.price,
  };
}

/**
 * POST /api/ai/scenes/:id/choose. An existing scene returns at once (with its status); a failed one is made
 * again under the same scene id. A completed story takes no more choices.
 */
export function demoChoose(
  state: DemoStoryState,
  input: { sceneId: string; choice: ChoiceId; price: number },
  now: number,
  newId: () => string,
): DemoResult {
  const { story, scene: parent } = findScene(state, input.sceneId);
  const parentRow = demoSceneRow(story, parent, now);
  // Like svc.ai_choose: once an ending is reached the story is completed, and no path goes on from any scene.
  if (parentRow.status !== 'ready' || parentRow.is_ending || demoStoryRow(story, now).status !== 'active') {
    throw new ApiError(409, 'scene_not_continuable');
  }

  const existing = story.scenes.find((s) => s.row.parent_scene_id === parent.row.id && s.row.chosen_choice === input.choice);
  const existingRow = existing ? demoSceneRow(story, existing, now) : null;
  if (existing && existingRow && existingRow.status !== 'failed') {
    return {
      state,
      started: {
        story_id: story.story.id, scene_id: existing.row.id, job_id: existing.job?.id ?? existing.row.id,
        existing: true, status: existingRow.status,
      },
      charged: 0,
    };
  }
  const busy = story.scenes.some((s) => {
    const status = demoSceneRow(story, s, now).status;
    return status === 'queued' || status === 'generating';
  });
  if (busy) throw new ApiError(409, 'scene_in_progress');

  const path = parent.path + input.choice;
  const tpl = demoTemplate(path);
  const outcome: DemoJob['outcome'] = tpl === 'blocked' ? 'blocked' : tpl ? 'ready' : 'failed';
  const job: DemoJob = { id: newId(), kind: 'scene', startedAt: now, outcome };
  const at = iso(now);
  const child: DemoScene = existing
    ? { ...existing, job }
    : {
      row: {
        id: newId(), story_id: story.story.id, parent_scene_id: parent.row.id, chosen_choice: input.choice,
        depth: parent.row.depth + 1, status: 'queued', title: null, is_ending: false, created_at: at,
      },
      path,
      job,
    };
  const scenes = existing ? story.scenes.map((s) => (s === existing ? child : s)) : [...story.scenes, child];
  const next: DemoStory = { ...story, scenes };
  return {
    state: { stories: state.stories.map((s) => (s === story ? next : s)) },
    started: { story_id: story.story.id, scene_id: child.row.id, job_id: job.id, existing: false, status: 'queued' },
    charged: outcome === 'ready' ? input.price : 0,
  };
}
