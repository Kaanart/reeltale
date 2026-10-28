// Routes for signed-in adults. The auth middleware verified the JWT (including age_ok) before these run.

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.ts';
import { serviceDb } from '../lib/db.ts';
import { dbErrorResponse, jsonError } from '../lib/http.ts';
import { createDirectUpload, hlsUrl, signPlaybackToken } from '../lib/stream.ts';
import { verifyTurnstile } from '../lib/turnstile.ts';

const UUID = z.string().uuid();

export const userRoutes = new Hono<AppContext>();

// Playback: the database decides; the Worker only signs what it was allowed to sign.
userRoutes.get('/playback/:episodeId', async (c) => {
  const ep = UUID.safeParse(c.req.param('episodeId'));
  if (!ep.success) return jsonError(c, 400, 'bad_request');
  let check: { allowed: boolean; reason: string; provider?: string; asset_id?: string; price?: number };
  try {
    check = await serviceDb(c.env).rpc('playback_check', { p_user: c.get('userId'), p_episode: ep.data });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  if (!check.allowed) {
    const status = check.reason === 'locked' ? 402 : check.reason === 'not_found' ? 404 : 403;
    return c.json({ error: check.reason, price: check.price }, status as 402);
  }
  if (check.provider !== 'cf_stream' || !check.asset_id) return jsonError(c, 501, 'unsupported_media');
  const { STREAM_SIGNING_KEY_ID, STREAM_SIGNING_KEY_JWK, STREAM_CUSTOMER_CODE } = c.env;
  if (!STREAM_SIGNING_KEY_ID || !STREAM_SIGNING_KEY_JWK || !STREAM_CUSTOMER_CODE) {
    return jsonError(c, 503, 'playback_not_configured');
  }
  const { token, expiresAt } = await signPlaybackToken({
    keyId: STREAM_SIGNING_KEY_ID, jwkJson: STREAM_SIGNING_KEY_JWK, videoUid: check.asset_id,
  });
  c.header('Cache-Control', 'private, no-store');
  return c.json({ hls: hlsUrl(STREAM_CUSTOMER_CODE, token), expires_at: expiresAt });
});

const UploadBody = z.object({ episode_id: z.string().uuid() });

// A one-time Stream upload URL for the creator's own draft episode.
userRoutes.post('/uploads', async (c) => {
  const body = UploadBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return jsonError(c, 400, 'bad_request');
  if (!c.env.STREAM_API_TOKEN) return jsonError(c, 503, 'uploads_not_configured');
  try {
    // Ownership, adult, consent and draft state are checked (and the episode marked processing) in SQL.
    await serviceDb(c.env).rpc('check_episode_upload', { p_user: c.get('userId'), p_episode: body.data.episode_id });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  try {
    const up = await createDirectUpload({
      accountId: c.env.CF_ACCOUNT_ID, apiToken: c.env.STREAM_API_TOKEN, episodeId: body.data.episode_id,
      appEnv: c.env.APP_ENV,
    });
    // Bind this upload to the episode: the Stream webhook may only attach this exact video.
    await serviceDb(c.env).rpc('bind_episode_upload', { p_episode: body.data.episode_id, p_asset_id: up.uid });
    c.header('Cache-Control', 'private, no-store');
    return c.json({ upload_url: up.uploadURL, max_duration_s: 120, max_bytes: 200 * 1024 * 1024 });
  } catch (err) {
    console.error('direct upload failed', err instanceof Error ? err.message : err);
    return jsonError(c, 502, 'upload_unavailable');
  }
});

const RedeemBody = z.object({
  code: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9-]+$/),
  turnstile_token: z.string().min(10).max(4096),
});

// Event/judge access codes. Web only: the browser's Origin must be our site (native apps never offer
// this, App Store rule 3.1.1). Turnstile stops scripted guessing.
userRoutes.post('/codes/redeem', async (c) => {
  if (c.req.header('Origin') !== c.env.APP_ORIGIN) return jsonError(c, 403, 'web_only');
  const body = RedeemBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return jsonError(c, 400, 'bad_request');
  if (!c.env.TURNSTILE_SECRET) return jsonError(c, 503, 'not_configured');
  const human = await verifyTurnstile({
    secret: c.env.TURNSTILE_SECRET, token: body.data.turnstile_token,
    remoteIp: c.req.header('CF-Connecting-IP') ?? undefined, expectedAction: 'redeem',
  });
  if (!human) return jsonError(c, 403, 'turnstile_failed');
  try {
    const r = await serviceDb(c.env).rpc('redeem_access_code', { p_user: c.get('userId'), p_code: body.data.code });
    return c.json(r);
  } catch (err) {
    return dbErrorResponse(c, err);
  }
});
