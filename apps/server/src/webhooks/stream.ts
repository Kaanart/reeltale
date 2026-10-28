// Cloudflare Stream webhook (one per account): a creator's upload finished encoding.
// Verified with HMAC over `${time}.${rawBody}` and a 5-minute timestamp window. The payload is treated
// as a pointer: we act only on the uid + our own episode_id from meta, and the database decides
// whether that episode may accept media.

import type { Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.ts';
import { DbError, serviceDb } from '../lib/db.ts';
import { verifyTimestampedHmac } from '../lib/crypto.ts';

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
  const raw = await c.req.text();
  if (raw.length > 64 * 1024) return c.json({ error: 'too_large' }, 413);
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
  try {
    // Poster and preview are copied to R2 by the ingest workflow (TODO D5); until then null.
    await serviceDb(env).rpc('attach_episode_media', {
      p_episode: episodeId, p_provider: 'cf_stream', p_asset_id: p.uid, p_duration_s: duration,
      p_poster_key: null, p_preview_key: null, p_manifest_key: null,
    });
  } catch (err) {
    // A second, late or unbound upload is refused by the database on purpose (approved media can't be
    // swapped). Acknowledge it so Stream doesn't retry.
    if (err instanceof DbError && (err.message === 'episode_not_accepting_media' || err.message === 'invalid_duration')) {
      console.warn('stream webhook: media refused', p.uid, err.message);
      return c.json({ ok: true, ignored: err.message });
    }
    console.error('stream webhook failed', err instanceof Error ? err.message : err);
    return c.json({ error: 'processing_failed' }, 500);
  }
  return c.json({ ok: true });
}
