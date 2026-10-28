// Small crypto helpers on WebCrypto (available in Workers and Node ≥ 20).

const enc = new TextEncoder();

/** Constant-time string comparison. Lengths are compared without an early exit on content. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parse "k1=v1,k2=v2" headers (RevenueCat and Stream signature formats). */
export function parseSignatureHeader(header: string | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!header) return out;
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k || !v) continue;
    out.set(k, [...(out.get(k) ?? []), v]);
  }
  return out;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

/**
 * Verify an HMAC-SHA256 webhook signature of the form `<tsKey>=<unix seconds>,<sigKey>=<hex>` over
 * `${ts}.${rawBody}`, rejecting timestamps outside `toleranceSec` (replay protection).
 * RevenueCat: tsKey "t", sigKey "v1". Cloudflare Stream: tsKey "time", sigKey "sig1".
 */
export async function verifyTimestampedHmac(opts: {
  header: string | null | undefined;
  rawBody: string;
  secret: string;
  tsKey: string;
  sigKey: string;
  nowSec: number;
  toleranceSec?: number;
}): Promise<SignatureCheck> {
  const parts = parseSignatureHeader(opts.header);
  if (parts.size === 0) return { ok: false, reason: 'missing' };
  const ts = parts.get(opts.tsKey)?.[0];
  const sigs = parts.get(opts.sigKey) ?? [];
  if (!ts || !/^\d{9,11}$/.test(ts) || sigs.length === 0) return { ok: false, reason: 'malformed' };
  const tolerance = opts.toleranceSec ?? 300;
  if (Math.abs(opts.nowSec - Number(ts)) > tolerance) return { ok: false, reason: 'stale' };
  const expected = await hmacSha256Hex(opts.secret, `${ts}.${opts.rawBody}`);
  // Several signatures may be present during secret rotation; any valid one is enough.
  let match = false;
  for (const s of sigs) match = timingSafeEqual(expected, s.toLowerCase()) || match;
  return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** Peppered SHA-256 of a normalized identity (e.g. email), hex. */
export async function sha256Hex(input: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert a DER-encoded ECDSA signature to the raw r||s (IEEE P1363) form WebCrypto expects.
 * Needed to verify AdMob server-side-verification callbacks (Phase 7).
 */
export function derToP1363(der: Uint8Array, size = 32): Uint8Array {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('not a DER sequence');
  let seqLen = der[i++] ?? 0;
  if (seqLen & 0x80) i += seqLen & 0x7f; // long-form length (unusual for P-256)
  const readInt = (): Uint8Array => {
    if (der[i++] !== 0x02) throw new Error('expected DER integer');
    const len = der[i++] ?? 0;
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    if (v.length > size) throw new Error('integer too long');
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  void seqLen;
  const out = new Uint8Array(size * 2);
  out.set(r, 0);
  out.set(s, size);
  return out;
}
