// Rows the AI story track reads straight from Supabase, with the granted column lists
// (supabase/migrations/20261027090500_ai.sql, 20261027090100_accounts.sql, 20261027090300_ledger.sql) and
// zod checks, so a row of the wrong shape is never half-shown. Pure: node tests import it.

import { z } from 'zod';
import type { AiSceneRow, AiStoryRow, TagRow } from '../../lib/types.ts';

export type { AiSceneRow, AiStoryRow, TagRow };

/** public.ai_jobs, owner-only. */
export interface AiJobRow {
  id: string;
  story_id: string;
  scene_id: string;
  kind: 'story_start' | 'scene';
  lane: 'scene' | 'prefetch' | 'video';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: string | null;
  error_code: string | null;
  created_at: string;
  finished_at: string | null;
}
export const AI_JOB_COLUMNS = 'id, story_id, scene_id, kind, lane, status, progress, error_code, created_at, finished_at';

/** public.ai_consents, owner-only. */
export interface AiConsentRow {
  user_id: string;
  purpose: 'story' | 'upload_processing' | 'voice';
  providers: string[];
  version: string;
  accepted_at: string;
  withdrawn_at: string | null;
}
export const AI_CONSENT_COLUMNS = 'user_id, purpose, providers, version, accepted_at, withdrawn_at';

/** public.pricing_config: readable by every signed-in user. */
export const PRICING_COLUMNS = 'key, value';

const uuid = z.string().uuid();
const text = z.string();

const StoryRowSchema = z.object({
  id: uuid,
  owner_id: uuid,
  premise: text,
  tags: z.array(text),
  mode: z.enum(['comic', 'video']),
  title: text.nullable(),
  status: z.enum(['planning', 'active', 'completed', 'failed', 'blocked']),
  visibility: z.enum(['private', 'published']),
  published_series_id: uuid.nullable(),
  created_at: text,
  updated_at: text,
});

const SceneRowSchema = z.object({
  id: uuid,
  story_id: uuid,
  parent_scene_id: uuid.nullable(),
  chosen_choice: z.enum(['a', 'b', 'c']).nullable(),
  depth: z.number().int(),
  status: z.enum(['queued', 'generating', 'ready', 'failed', 'blocked']),
  title: text.nullable(),
  is_ending: z.boolean(),
  created_at: text,
});

/** Enough of a scene row to pick the one a story opens at (logic.ts sceneToOpen). */
export type AiSceneHead = Pick<AiSceneRow, 'id' | 'status' | 'created_at'>;
export const AI_SCENE_HEAD_COLUMNS = 'id, status, created_at';
const SceneHeadSchema = SceneRowSchema.pick({ id: true, status: true, created_at: true });

const JobRowSchema = z.object({
  id: uuid,
  story_id: uuid,
  scene_id: uuid,
  kind: z.enum(['story_start', 'scene']),
  lane: z.enum(['scene', 'prefetch', 'video']),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  progress: text.nullable(),
  error_code: text.nullable(),
  created_at: text,
  finished_at: text.nullable(),
});

const ConsentRowSchema = z.object({
  user_id: uuid,
  purpose: z.enum(['story', 'upload_processing', 'voice']),
  providers: z.array(text),
  version: text,
  accepted_at: text,
  withdrawn_at: text.nullable(),
});

const TagRowSchema = z.object({
  id: z.number().int(),
  kind: z.enum(['genre', 'trope', 'warning']),
  slug: text,
  name_i18n: z.object({ en: text }).catchall(text),
  sort: z.number(),
});

const parser = <S extends z.ZodType>(schema: S) => (raw: unknown): z.output<S> | null => {
  const r = schema.safeParse(raw);
  return r.success ? r.data : null;
};

export const parseStoryRow: (raw: unknown) => AiStoryRow | null = parser(StoryRowSchema);
export const parseSceneRow: (raw: unknown) => AiSceneRow | null = parser(SceneRowSchema);
export const parseSceneHead: (raw: unknown) => AiSceneHead | null = parser(SceneHeadSchema);
export const parseJobRow: (raw: unknown) => AiJobRow | null = parser(JobRowSchema);
export const parseConsentRow: (raw: unknown) => AiConsentRow | null = parser(ConsentRowSchema);
export const parseTagRow: (raw: unknown) => TagRow | null = parser(TagRowSchema);

/** A list of rows; null when any row has the wrong shape. */
export function parseRows<T>(raw: unknown, parse: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null;
  const out: T[] = [];
  for (const row of raw) {
    const r = parse(row);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}
