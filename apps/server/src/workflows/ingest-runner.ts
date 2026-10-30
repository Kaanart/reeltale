// The EpisodeIngest pipeline: what happens after a creator's upload finishes processing on Cloudflare
// Stream. Kept free of cloudflare:* imports so it runs under Node tests with a fake step runner;
// episode-ingest.ts adapts it to Cloudflare Workflows.
//
//   context → delete videos this episode replaced → start Stream captions → frames → transcript (bounded
//   wait) → review (one paid call per version, within the daily cap) → svc.record_verdict
//   → held for an editor: wait for the decision → approved: poster and preview to the public bucket
//
// Each external call is its own step; steps return small values and bytes go to R2 inside the step. The
// review frames go to the private bucket and are deleted after the review. Nothing reaches the public
// bucket before the episode is approved. Every way out of the review leaves a verdict, so no episode
// waits for a review nobody will do: a failure hands it to an editor.

import { MetaApiError } from '../ai/meta.ts';
import {
  CAPTION_LANGUAGES, STREAM_UID, vttToText, type CaptionState, type ThumbnailOptions,
} from '../lib/stream-media.ts';
import { decide, MEDIA_REVIEW_MODEL, reviewEpisodeMedia, type Decision } from '../moderation/episode-media.ts';
import type { MetaClient } from '../ai/meta.ts';
import type { StepConfig, StepRunner } from './scene-runner.ts';

export interface IngestPayload {
  episodeId: string;
  assetId: string;
}

export interface IngestContext {
  episode_id: string;
  content_version: number;
  title: string;
  duration_s: number | null;
  status: string;
  moderation_status: 'pending' | 'approved' | 'rejected';
  provider: string | null;
  asset_id: string | null;
  awaiting_editor: boolean;
  series: { title: string; synopsis: string; maturity: 'general' | 'mature'; format: string; language: string };
}

export interface IngestStepRunner extends StepRunner {
  sleep(name: string, duration: string | number): Promise<void>;
}

export interface IngestIO {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** A still (JPEG) or animated (GIF) thumbnail of the video, through a short-lived signed URL. */
  thumbnail(assetId: string, o: ThumbnailOptions): Promise<Uint8Array>;
  startCaptions(assetId: string, lang: string): Promise<boolean>;
  captionState(assetId: string, lang: string): Promise<CaptionState>;
  captionVtt(assetId: string, lang: string): Promise<string>;
  deleteVideo(assetId: string): Promise<void>;
  /** The public media bucket (served at MEDIA_ORIGIN). */
  putPublic(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  deletePublic(keys: string[]): Promise<void>;
  /** The private bucket, for review frames. */
  putPrivate(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getPrivate(key: string): Promise<Uint8Array>;
  deletePrivate(keys: string[]): Promise<void>;
  meta(): MetaClient;
  /** Where the transcript comes from: Stream's generated captions, or nowhere. */
  transcript: 'stream_captions' | 'off';
  /**
   * The animated GIF preview. Off by default: it shows ~24 frames of which the review saw one, so a creator
   * who knows the window could put unreviewed images on the public bucket. Turn on only once every preview
   * frame is reviewed too.
   */
  animatedPreview: boolean;
  /** An error the step runner must not retry (NonRetryableError on Workers). */
  fatal(code: string): Error;
  log(message: string): void;
}

export type IngestOutcome = 'approved' | 'rejected' | 'held' | 'skipped';

export const CHEAP: StepConfig = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '1 minute' };
export const PAID: StepConfig = { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '3 minutes' };
/** Captions are a bonus: one quick retry, then the pipeline goes on without them. */
export const BEST_EFFORT: StepConfig = { retries: { limit: 1, delay: '5 seconds' }, timeout: '30 seconds' };

export const FRAME_COUNT = 8;
/** Paid reviews per upload: a title change during the first one gets a second; after that an editor decides. */
export const MAX_REVIEWS = 2;
/** The review waits at most TRANSCRIPT_POLLS × 30 s (plus the polls) for the transcript. */
export const TRANSCRIPT_POLLS = 6;
export const TRANSCRIPT_POLL_EVERY = '30 seconds';
/** How long a held episode is watched for the editor's decision (about 3 days in all). */
export const EDITOR_WAITS = ['10 minutes', '30 minutes', '1 hour', '2 hours', '4 hours', '8 hours',
  '12 hours', '12 hours', '12 hours', '12 hours', '12 hours'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ingestKeys = {
  frame: (episodeId: string, assetId: string, n: number) => `ingest/${episodeId}/${assetId}/frame-${n}.jpg`,
  poster: (episodeId: string, assetId: string) => `public/posters/${episodeId}/${assetId}.jpg`,
  preview: (episodeId: string, assetId: string) => `public/previews/${episodeId}/${assetId}.gif`,
};

/** One instance per upload, so a retried webhook can't run it twice. */
export function ingestInstanceId(assetId: string): string {
  return `ingest-${assetId}`;
}

/** FRAME_COUNT evenly spaced times in whole seconds; a very short video gives fewer, distinct ones. */
export function frameTimes(durationS: number, n = FRAME_COUNT): number[] {
  const d = Math.max(1, Math.floor(durationS));
  return [...new Set(Array.from({ length: n }, (_, i) => Math.min(d - 1, Math.floor((d * (i + 0.5)) / n))))];
}

/** The caption language for a series language (e.g. 'pt-BR' → 'pt'), or null if Stream can't do it. */
export function captionLanguage(language: string): string | null {
  const base = language.slice(0, 2).toLowerCase();
  return (CAPTION_LANGUAGES as readonly string[]).includes(base) ? base : null;
}

/** Is this upload still the episode's media, ready and waiting for its first review? */
function waiting(ctx: IngestContext | null, assetId: string): ctx is IngestContext {
  return !!ctx && ctx.asset_id === assetId && ctx.provider === 'cf_stream' && ctx.status === 'ready'
    && ctx.moderation_status === 'pending';
}

interface Verdict {
  decision: Decision;
  categories: string[];
  reason: string;
  /** Null when no model was asked (cap, failure): the verdict log says who decided. */
  model: string | null;
}

export async function runIngest(io: IngestIO, step: IngestStepRunner, payload: IngestPayload): Promise<IngestOutcome> {
  const { episodeId, assetId } = payload;
  if (!UUID.test(episodeId) || !STREAM_UID.test(assetId)) {
    io.log(`ingest: bad payload ${JSON.stringify(payload).slice(0, 200)}`);
    return 'skipped';
  }
  const context = (name: string) => step.do(name, CHEAP, () => io.rpc<IngestContext | null>('ingest_context', { p_episode: episodeId }));
  const record = (name: string, version: number, v: Verdict) => step.do(name, CHEAP, () => io.rpc<string>('record_verdict', {
    p_target: 'episode', p_id: episodeId, p_version: version, p_source: 'auto', p_model: v.model,
    p_decision: v.decision, p_categories: v.categories, p_reason: v.reason, p_editor: null,
  }));
  const bestEffort = async <T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      io.log(`ingest ${episodeId}: ${what} failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`);
      return fallback;
    }
  };

  const ctx = await context('context');
  if (!ctx) return 'skipped';
  // Any run for this episode may delete the videos it replaced; the database never lists one in use.
  // Best effort: what isn't deleted now stays queued for the next run or a sweep.
  await bestEffort('cleanup', () => step.do('cleanup', BEST_EFFORT, async () => {
    const due = (await io.rpc<string[]>('stream_cleanup_due', { p_episode: episodeId, p_limit: 20 })) ?? [];
    const done: string[] = [];
    for (const uid of due) {
      if (!STREAM_UID.test(uid)) continue;
      await io.deleteVideo(uid);
      done.push(uid);
    }
    if (done.length) await io.rpc('stream_cleanup_done', { p_asset_ids: done });
    return done.length;
  }), 0);
  if (!waiting(ctx, assetId)) return 'skipped';

  // Captions are generated by Stream in the background while the frames are taken.
  const lang = io.transcript === 'stream_captions' ? captionLanguage(ctx.series.language) : null;
  const captioning = lang
    ? await bestEffort('captions', () => step.do('captions:start', BEST_EFFORT, () => io.startCaptions(assetId, lang)), false)
    : false;

  // Small frames (at most 512 px, whole frame kept) at even times, one step each.
  const times = frameTimes(ctx.duration_s ?? 1);
  const frameKeys = times.map((_, i) => ingestKeys.frame(episodeId, assetId, i + 1));
  // Every frame step is waited for, even after one failed, so the clean-up below can't run before a
  // slower frame is written (it would stay in the bucket).
  const taken = await Promise.allSettled(times.map((time, i) => step.do(`frame:${i + 1}`, CHEAP, async () => {
    const bytes = await io.thumbnail(assetId, { time, width: 512, height: 512, fit: 'clip' });
    await io.putPrivate(frameKeys[i]!, bytes, 'image/jpeg');
    return frameKeys[i]!;
  })));
  const failed = taken.find((r) => r.status === 'rejected');
  if (failed) {
    const e = failed.reason;
    io.log(`ingest ${episodeId}: frames failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`);
  }
  const frames = failed ? [] : taken.map((r) => (r as PromiseFulfilledResult<string>).value);

  let transcript: string | null = null;
  if (captioning && lang && frames.length) {
    for (let i = 1; i <= TRANSCRIPT_POLLS; i++) {
      await step.sleep(`captions:wait:${i}`, TRANSCRIPT_POLL_EVERY);
      const state = await bestEffort('captions', () =>
        step.do(`captions:poll:${i}`, BEST_EFFORT, () => io.captionState(assetId, lang)), 'error' as CaptionState);
      if (state === 'ready') {
        transcript = await bestEffort('captions', () => step.do('captions:text', BEST_EFFORT, async () =>
          vttToText(await io.captionVtt(assetId, lang)) || null), null);
      }
      if (state !== 'inprogress') break;
    }
  }

  let outcome: IngestOutcome;
  try {
    outcome = frames.length
      ? await reviewRounds()
      : await handOff('frames_unavailable');
  } catch (e) {
    // Anything unexpected (a database call that kept failing): one more try to leave it with an editor.
    io.log(`ingest ${episodeId}: review stage failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`);
    outcome = await handOff('ingest_failed', 'rescue');
  } finally {
    // Every frame key, including any written by a frame step that later failed.
    await bestEffort('tidy', () => step.do('tidy', BEST_EFFORT, async () => {
      await io.deletePrivate(frameKeys);
      return true;
    }), false);
  }
  if (outcome === 'held') outcome = await waitForEditor();
  if (outcome === 'approved') await publishMedia();
  return outcome;

  // One paid review per version. A title change during the review makes the verdict stale: the new
  // version gets one more review, then an editor.
  async function reviewRounds(): Promise<IngestOutcome> {
    for (let round = 1; round <= MAX_REVIEWS; round++) {
      const cur = await context(`recheck:${round}`);
      if (!waiting(cur, assetId)) return 'skipped';
      const claim = await step.do(`claim:${round}`, CHEAP, () => io.rpc<string>('ingest_claim_review', {
        p_episode: episodeId, p_asset_id: assetId, p_version: cur.content_version,
      }));
      if (claim === 'reviewed') return 'skipped';
      if (claim === 'stale') continue;
      const v: Verdict = claim === 'over_cap'
        ? { decision: 'needs_editor', categories: [], reason: 'daily_review_cap', model: null }
        : await review(round, cur);
      const result = await record(`verdict:${round}`, cur.content_version, v);
      if (result === 'stale_verdict') continue;
      if (result === 'held') return 'held';
      if (result === 'applied') return v.decision === 'approved' ? 'approved' : 'rejected';
      // not_applicable: removed or approved meanwhile, or our own approval whose answer was lost and retried.
      const after = await context(`after:${round}`);
      return after?.asset_id === assetId && after.status !== 'removed' && after.moderation_status === 'approved' ? 'approved' : 'skipped';
    }
    return handOff('changed_during_review');
  }

  async function review(round: number, cur: IngestContext): Promise<Verdict> {
    try {
      return await step.do(`review:${round}`, PAID, async () => {
        try {
          const images = await Promise.all(frames.map((k) => io.getPrivate(k)));
          const v = await reviewEpisodeMedia(io.meta(), { title: cur.title, series: cur.series, transcript }, images);
          return { decision: decide(v), categories: [...v.categories], reason: v.reason, model: MEDIA_REVIEW_MODEL };
        } catch (e) {
          // The provider refused to look at it: a person decides.
          if (e instanceof MetaApiError && e.code === 'content_policy') {
            return { decision: 'needs_editor' as Decision, categories: [], reason: 'provider_policy', model: MEDIA_REVIEW_MODEL };
          }
          if (e instanceof MetaApiError && !e.retryable) throw io.fatal(`review_failed:${e.code}`);
          throw e;
        }
      });
    } catch (e) {
      io.log(`ingest ${episodeId}: review failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`);
      return { decision: 'needs_editor', categories: [], reason: 'review_failed', model: null };
    }
  }

  /** Hand the current version to an editor (no model call). */
  async function handOff(reason: string, name = 'handoff'): Promise<IngestOutcome> {
    const cur = await context(`${name}:context`);
    if (!waiting(cur, assetId)) return 'skipped';
    if (cur.awaiting_editor) return 'held';
    const result = await record(name, cur.content_version, { decision: 'needs_editor', categories: [], reason, model: null });
    return result === 'held' ? 'held' : 'skipped';
  }

  // Poster and preview only exist for approved media, so the run waits for the editor's decision. A
  // title change while held is a new version without a verdict: it goes to the editor too.
  async function waitForEditor(): Promise<IngestOutcome> {
    for (let i = 1; i <= EDITOR_WAITS.length; i++) {
      await step.sleep(`editor:wait:${i}`, EDITOR_WAITS[i - 1]!);
      const cur = await context(`editor:check:${i}`);
      if (!cur || cur.asset_id !== assetId || cur.status === 'removed') return 'skipped';
      if (cur.moderation_status !== 'pending') return cur.moderation_status;
      if (waiting(cur, assetId) && !cur.awaiting_editor) await handOff('changed_while_held', `editor:handoff:${i}`);
    }
    return 'held';
  }

  async function publishMedia(): Promise<void> {
    const d = Math.max(1, ctx!.duration_s ?? 1);
    // The poster is a frame the review saw (the second, about a fifth in): the public bucket and the
    // listings never show a moment no reviewer looked at. The preview starts there.
    const start = times[Math.min(1, times.length - 1)]!;
    const poster = await bestEffort('poster', () => step.do('poster', CHEAP, async () => {
      const bytes = await io.thumbnail(assetId, { time: start, width: 720, height: 1280, fit: 'crop' });
      const key = ingestKeys.poster(episodeId, assetId);
      await io.putPublic(key, bytes, 'image/jpeg');
      return key;
    }), null);
    if (!poster) return;
    // A short looping preview: Stream renders animated GIF thumbnails from the same signed URL.
    const preview = !io.animatedPreview ? null : await bestEffort('preview', () => step.do('preview', CHEAP, async () => {
      const bytes = await io.thumbnail(assetId, {
        time: start, width: 270, height: 480, fit: 'crop', animated: { duration: Math.min(3, d), fps: 8 },
      });
      const key = ingestKeys.preview(episodeId, assetId);
      await io.putPublic(key, bytes, 'image/gif');
      return key;
    }), null);
    await bestEffort('media', () => step.do('media', CHEAP, async () => {
      const set = await io.rpc<boolean>('ingest_set_media', {
        p_episode: episodeId, p_asset_id: assetId, p_poster_key: poster, p_preview_key: preview,
      });
      // The episode moved on (removed, replaced): nothing may point at these objects, so remove them.
      if (!set) await io.deletePublic([poster, ...(preview ? [preview] : [])]);
      return set;
    }), false);
  }
}
