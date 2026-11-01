// Row shapes of what the app may read straight from Supabase, column for column from the `grant select`
// lines in supabase/migrations. Selecting a column that isn't granted fails the whole query
// ("permission denied"), so select with the *_COLUMNS strings below rather than '*'.
// Replace with `supabase gen types` output once the project exists; keep the column lists.

import type { AgeStatus, Role } from './gate.ts';

export type { AgeStatus, Role };
export type SeriesFormat = 'live_action' | 'stop_motion' | 'ai_generated';
export type Maturity = 'general' | 'mature';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

/** public.profiles (20261027090100_accounts.sql). */
export interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_key: string | null;
}
export const PROFILE_COLUMNS = 'id, handle, display_name, bio, avatar_key';

/** public.profile_private, owner-only (20261027090100_accounts.sql). */
export interface ProfilePrivateRow {
  user_id: string;
  date_of_birth: string | null;
  age_status: AgeStatus;
  country: string | null;
  locale: string | null;
  mature_opt_in: boolean;
  tos_version: string | null;
  tos_accepted_at: string | null;
  ai_safety_ack_at: string | null;
  ai_access_until: string | null;
}
/** What the auth feature loads. The date of birth is left out on purpose: no screen needs it back. */
export type AccountRow = Omit<ProfilePrivateRow, 'date_of_birth'>;
export const ACCOUNT_COLUMNS =
  'user_id, age_status, country, locale, mature_opt_in, tos_version, tos_accepted_at, ai_safety_ack_at, ai_access_until';

/** public.tags (20261027090200_catalog.sql). */
export interface TagRow {
  id: number;
  kind: 'genre' | 'trope' | 'warning';
  slug: string;
  name_i18n: { en: string } & Record<string, string>;
  sort: number;
}
export const TAG_COLUMNS = 'id, kind, slug, name_i18n, sort';

/** public.series (20261027090200_catalog.sql). */
export interface SeriesRow {
  id: string;
  creator_id: string | null;
  slug: string;
  title: string;
  synopsis: string;
  cover_key: string | null;
  language: string;
  format: SeriesFormat;
  origin: 'creator' | 'ai_story';
  editors_pick: boolean;
  maturity: Maturity;
  status: 'draft' | 'published' | 'hidden' | 'removed';
  moderation_status: ModerationStatus;
  free_episode_count: number;
  default_price_coins: number | null;
  completed: boolean;
  tag_ids: number[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
export const SERIES_COLUMNS =
  'id, creator_id, slug, title, synopsis, cover_key, language, format, origin, editors_pick, maturity, status, ' +
  'moderation_status, free_episode_count, default_price_coins, completed, tag_ids, published_at, created_at, updated_at';

/** public.episodes (20261027090200_catalog.sql). */
export interface EpisodeRow {
  id: string;
  series_id: string;
  number: number;
  title: string;
  duration_s: number | null;
  kind: 'video' | 'ai_comic' | 'ai_video' | 'frame_sequence';
  price_coins: number | null;
  is_free: boolean;
  status: 'draft' | 'processing' | 'ready' | 'published' | 'closed_to_new' | 'removed';
  moderation_status: ModerationStatus;
  poster_key: string | null;
  preview_key: string | null;
  published_at: string | null;
}
export const EPISODE_COLUMNS =
  'id, series_id, number, title, duration_s, kind, price_coins, is_free, status, moderation_status, poster_key, preview_key, published_at';

/** public.ai_stories, owner-only (20261027090500_ai.sql). */
export interface AiStoryRow {
  id: string;
  owner_id: string;
  premise: string;
  tags: string[];
  mode: 'comic' | 'video';
  title: string | null;
  status: 'planning' | 'active' | 'completed' | 'failed' | 'blocked';
  visibility: 'private' | 'published';
  published_series_id: string | null;
  created_at: string;
  updated_at: string;
}
export const AI_STORY_COLUMNS =
  'id, owner_id, premise, tags, mode, title, status, visibility, published_series_id, created_at, updated_at';

/** public.ai_scenes, owner-only (20261027090500_ai.sql). */
export interface AiSceneRow {
  id: string;
  story_id: string;
  parent_scene_id: string | null;
  chosen_choice: 'a' | 'b' | 'c' | null;
  depth: number;
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'blocked';
  title: string | null;
  is_ending: boolean;
  created_at: string;
}
export const AI_SCENE_COLUMNS = 'id, story_id, parent_scene_id, chosen_choice, depth, status, title, is_ending, created_at';
