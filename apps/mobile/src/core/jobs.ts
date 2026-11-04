// What to show while an AI scene is being made, from a row of public.ai_jobs (status, progress, error_code).
// The app gets the row by refetching after a Realtime "id only" event.
//
// The Worker's scene runner (apps/server/src/workflows/scene-runner.ts) writes `progress` in this order:
//   planning, casting   (only for the first scene of a story: Muse Wonder's arc, then the characters)
//   writing, drawing, checking, framing
// and svc.ai_scene_ready sets it to 'ready'. A failed job keeps its error_code: `blocked:<reason>` when
// the safety check refused the scene, otherwise a short name such as generation_failed.
// Failure text never includes the reason a scene was blocked: the user is told it couldn't be made safely.

export const JOB_STEPS = ['planning', 'casting', 'writing', 'drawing', 'checking', 'framing', 'ready'] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/** The first scene of a story also plans the arc and casts the characters; later scenes start at writing. */
export function stepsFor(kind: 'story_start' | 'scene'): readonly JobStep[] {
  return kind === 'story_start' ? JOB_STEPS : JOB_STEPS.filter((s) => s !== 'planning' && s !== 'casting');
}

export interface JobRow {
  status: string;
  progress: string | null;
  error_code: string | null;
}

export type JobPhase = 'queued' | 'running' | 'ready' | 'failed' | 'blocked';

export interface JobView {
  phase: JobPhase;
  /** The step label to show: an `ai:progress.*` key. */
  key: string;
  /** The known step, when `progress` named one. */
  step: JobStep | null;
  /** 0 to 1 for a progress bar. Never goes backwards as the steps advance. */
  fraction: number;
  /** Why it stopped: an `ai:failure.*` key, only when phase is failed or blocked. */
  failureKey: string | null;
  /** No more changes will come. */
  finished: boolean;
}

/** Every i18n key this file can return. For tests and tooling. */
export const JOB_KEYS: readonly string[] = [
  ...JOB_STEPS.map((s) => `ai:progress.${s}`),
  'ai:progress.queued', 'ai:progress.working', 'ai:progress.failed', 'ai:progress.blocked',
  'ai:failure.blocked', 'ai:failure.paused', 'ai:failure.failed',
];

/** The message for a failed job's error_code. Blocked scenes are refunded like failed ones. */
export function jobFailureKey(errorCode: string | null | undefined): string {
  if (errorCode && errorCode.startsWith('blocked')) return 'ai:failure.blocked';
  if (errorCode === 'daily_budget_exceeded' || errorCode === 'storage_budget_exceeded') return 'ai:failure.paused';
  return 'ai:failure.failed';
}

export function describeJob(row: JobRow, kind: 'story_start' | 'scene' = 'scene'): JobView {
  const steps = stepsFor(kind);
  if (row.status === 'succeeded') {
    return { phase: 'ready', key: 'ai:progress.ready', step: 'ready', fraction: 1, failureKey: null, finished: true };
  }
  if (row.status === 'failed') {
    const blocked = !!row.error_code && row.error_code.startsWith('blocked');
    return {
      phase: blocked ? 'blocked' : 'failed',
      key: blocked ? 'ai:progress.blocked' : 'ai:progress.failed',
      step: null, fraction: 0, failureKey: jobFailureKey(row.error_code), finished: true,
    };
  }
  const step = steps.find((s) => s === row.progress) ?? null;
  if (step) {
    // Halfway through the current step: the bar moves as soon as a step starts and reaches 1 only when the job has succeeded.
    return {
      phase: 'running', key: `ai:progress.${step}`, step,
      fraction: (steps.indexOf(step) + 0.5) / steps.length, failureKey: null, finished: false,
    };
  }
  // Queued (no progress yet), or a step name this build doesn't know.
  const queued = row.status === 'queued' && row.progress === null;
  return {
    phase: queued ? 'queued' : 'running', key: queued ? 'ai:progress.queued' : 'ai:progress.working',
    step: null, fraction: 0.02, failureKey: null, finished: false,
  };
}
