// Cloudflare Stream webhook (one per account): a creator's upload finished encoding.
// Verified with HMAC over `${time}.${rawBody}` and a 5-minute timestamp window. The payload is treated
// as a pointer: we act only on the uid + our own episode_id from meta, and the database decides
// whether that episode may accept media. Accepted media starts the EpisodeIngest workflow (one
// instance per upload); a redelivered webhook for media that is already attached starts it again,
// which is a no-op if it exists.

import { readCappedText } from '../lib/http.ts';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppContext, Env } from '../env.ts';
import { DbError, serviceDb, type Db } from '../lib/db.ts';
import { verifyTimestampedHmac } from '../lib/crypto.ts';
import { STREAM_UID } from '../lib/stream-media.ts';
import { ingestInstanceId, type IngestContext } from '../workflows/ingest-runner.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Payload = z.object({
  uid: z.string().regex(/^[a-f0-9]{32}$/),
  readyToStream: z.boolean().optional(),
  status: z.object({ state: z.string() }).partial().optional(),
  duration: z.number().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function streamWebhook(c: Context<AppContext>) {
  const env = c.env;
  if (!env.STREAM_WEBHOOK_SECRET) return c.json({ error: 'not_configured' }, 503);
  const raw = await readCappedText(c.req.raw, 64 * 1024);
  if (raw === null) return c.json({ error: 'too_large' }, 413);
  const sig = await verifyTimestampedHmac({
    header: c.req.header('Webhook-Signature'), rawBody: raw, secret: env.STREAM_WEBHOOK_SECRET,
    tsKey: 'time', sigKey: 'sig1', nowSec: Math.floor(Date.now() / 1000),
  });
  if (!sig.ok) return c.json({ error: 'bad_signature', reason: sig.reason }, 401);

  let p: z.infer<typeof Payload>;
  try {
    p = Payload.parse(JSON.parse(raw));
  } catch {
    return c.json({ error: 'bad_payload' }, 400);
  }
  const meta = p.meta ?? {};
  const episodeId = typeof meta.episode_id === 'string' ? meta.episode_id : '';
  if (meta.kind !== 'episode' || !UUID.test(episodeId)) return c.json({ ok: true, ignored: 'not_an_episode' });
  if (meta.env !== env.APP_ENV) {
    // The account has one webhook; staging uploads arrive here too. They belong to the other Worker.
    return c.json({ ok: true, ignored: 'other_env' });
  }
  if (!p.readyToStream || p.status?.state !== 'ready') return c.json({ ok: true, ignored: 'not_ready' });

  const duration = Math.round(p.duration ?? 0);
  if (duration < 1 || duration > 120) {
    // Uploads are capped at 120 s by maxDurationSeconds, so this shouldn't happen; acknowledge it
    // (no endless retries) and leave the episode in processing for a person to look at.
    console.error('stream webhook: unexpected duration', p.uid, p.duration);
    return c.json({ ok: true, ignored: 'bad_duration' });
  }
  const db = () => serviceDb(env);
  try {
    // Poster and preview are made by the ingest workflow once the episode is approved.
    await db().rpc('attach_episode_media', {
      p_episode: episodeId, p_provider: 'cf_stream', p_asset_id: p.uid, p_duration_s: duration,
      p_poster_key: null, p_preview_key: null, p_manifest_key: null,
    });
  } catch (err) {
    const refused = err instanceof DbError && (err.message === 'episode_not_accepting_media' || err.message === 'invalid_duration');
    if (!refused) {
      console.error('stream webhook failed', err instanceof Error ? err.message : err);
      return c.json({ error: 'processing_failed' }, 500);
    }
    // A redelivery of a webhook we already handled (e.g. after a 500 below): this very video is the
    // episode's media already, so carry on and make sure the ingest workflow exists.
    let attached = false;
    try {
      const ctx = await db().rpc<{ asset_id: string | null; provider: string | null; status: string } | null>(
        'ingest_context', { p_episode: episodeId });
      attached = ctx?.asset_id === p.uid && ctx.provider === 'cf_stream' && ctx.status === 'ready';
    } catch (e) {
      console.error('stream webhook failed', e instanceof Error ? e.message : e);
      return c.json({ error: 'processing_failed' }, 500);
    }
    if (!attached) {
      // A second, late or unbound upload is refused by the database on purpose (approved media can't be
      // swapped). Acknowledge it so Stream doesn't retry.
      console.warn('stream webhook: media refused', p.uid, (err as DbError).message);
      return c.json({ ok: true, ignored: (err as DbError).message });
    }
  }
  try {
    await startIngest(env, episodeId, p.uid);
  } catch (err) {
    // The media is attached but nothing would review it: fail so Stream delivers the webhook again.
    console.error('stream webhook: ingest start failed', err instanceof Error ? err.message : err);
    return c.json({ error: 'processing_failed' }, 500);
  }
  return c.json({ ok: true });
}

/** Start the ingest workflow for an attached upload. An instance that already exists counts as started. */
export async function startIngest(env: Env, episodeId: string, assetId: string): Promise<'started' | 'exists'> {
  const id = ingestInstanceId(assetId);
  try {
    await env.EPISODE_INGEST.create({ id, params: { episodeId, assetId } });
    return 'started';
  } catch (err) {
    if (err instanceof Error && /already exists|duplicate/i.test(err.message)) return 'exists';
    // The error text isn't documented: ask for the instance before giving up.
    if (await env.EPISODE_INGEST.get(id).then(() => true, () => false)) return 'exists';
    throw err;
  }
}

/**
 * Cron backstop for a lost webhook: (re)start the ingest workflow of uploads that are ready and still
 * waiting for their first review (not handed to an editor). The webhook gets 10 minutes first; a running
 * instance makes this a no-op. An instance that has stopped (it failed, e.g. the database was down, or it
 * ended before a later title change) will never review the upload, and its id can't be used again: the
 * episode goes to an editor instead of waiting forever. Returns how many were started.
 */
export async function sweepIngest(env: Env, db: Db, nowMs = Date.now()): Promise<number> {
  const items = await db.rpc<{ id: string; since: string; content: { provider?: string; asset_id?: string } }[]>(
    'moderation_queue', { p_limit: 20, p_targets: ['episode'], p_for_editor: false });
  let started = 0;
  for (const item of items ?? []) {
    const assetId = item.content?.asset_id ?? '';
    if (item.content?.provider !== 'cf_stream' || !STREAM_UID.test(assetId) || !UUID.test(item.id)) continue;
    if (!(Date.parse(item.since) < nowMs - 10 * 60_000)) continue;
    if ((await startIngest(env, item.id, assetId)) === 'started') {
      started++;
      continue;
    }
    const status = await env.EPISODE_INGEST.get(ingestInstanceId(assetId)).then((i) => i.status(), () => null);
    if (!status || !['errored', 'terminated', 'complete'].includes(status.status)) continue;
    // Check again: the queue was read before the instance's status, and the run may just have decided.
    const ctx = await db.rpc<IngestContext | null>('ingest_context', { p_episode: item.id });
    if (!ctx || ctx.asset_id !== assetId || ctx.provider !== 'cf_stream' || ctx.status !== 'ready'
        || ctx.moderation_status !== 'pending' || ctx.awaiting_editor) continue;
    await db.rpc('record_verdict', {
      p_target: 'episode', p_id: item.id, p_version: ctx.content_version, p_source: 'auto', p_model: null,
      p_decision: 'needs_editor', p_categories: [], p_reason: 'ingest_stopped', p_editor: null,
    });
  }
  return started;
}
