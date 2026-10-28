// Cloudflare Stream: one-time direct upload URLs for creators, and locally signed playback tokens.
// Every ReelTale video requires signed URLs; a token is minted only after the entitlement check
// (svc.playback_check), and never for a locked episode, not even for thumbnails.

import { SignJWT, importJWK, type JWK } from 'jose';

export interface DirectUpload {
  uploadURL: string;
  uid: string;
}

/** Create a one-time upload URL (basic POST upload, files up to 200 MB). Episodes are capped at 120 s. */
export async function createDirectUpload(opts: {
  accountId: string;
  apiToken: string;
  episodeId: string;
  appEnv: string;
  expiresInMin?: number;
  fetchImpl?: typeof fetch;
}): Promise<DirectUpload> {
  const f = opts.fetchImpl ?? fetch;
  const expiry = new Date(Date.now() + (opts.expiresInMin ?? 30) * 60_000).toISOString();
  const res = await f(`https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/stream/direct_upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maxDurationSeconds: 120,
      requireSignedURLs: true,
      expiry,
      // meta is echoed back in the Stream webhook; env lets one account-wide webhook be routed.
      meta: { episode_id: opts.episodeId, env: opts.appEnv, kind: 'episode' },
    }),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; result?: DirectUpload } | null;
  if (!res.ok || !body?.success || !body.result?.uploadURL || !body.result.uid) {
    throw new Error(`stream direct_upload failed (${res.status})`);
  }
  return { uploadURL: body.result.uploadURL, uid: body.result.uid };
}

const keyCache = new Map<string, CryptoKey>();

/**
 * Sign a Stream playback token (RS256) for one video. TTL ≤ 2 h (Stream allows up to 24 h; shorter limits
 * how long a leaked URL works). No download access.
 */
export async function signPlaybackToken(opts: {
  keyId: string;
  jwkJson: string;
  videoUid: string;
  ttlSec?: number;
  nowSec?: number;
}): Promise<{ token: string; expiresAt: number }> {
  const ttl = Math.min(opts.ttlSec ?? 7200, 7200);
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  let key = keyCache.get(opts.keyId);
  if (!key) {
    // Stream hands out the signing key as base64-encoded JWK.
    const raw = opts.jwkJson.trim().startsWith('{') ? opts.jwkJson : atob(opts.jwkJson);
    key = (await importJWK(JSON.parse(raw) as JWK, 'RS256')) as CryptoKey;
    keyCache.set(opts.keyId, key);
  }
  const exp = now + ttl;
  const token = await new SignJWT({ downloadable: false })
    .setProtectedHeader({ alg: 'RS256', kid: opts.keyId })
    .setSubject(opts.videoUid)
    .setNotBefore(now - 60)
    .setExpirationTime(exp)
    .sign(key);
  return { token, expiresAt: exp };
}

export function hlsUrl(customerCode: string, token: string): string {
  return `https://customer-${customerCode}.cloudflarestream.com/${token}/manifest/video.m3u8`;
}
