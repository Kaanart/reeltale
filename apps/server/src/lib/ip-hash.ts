// Rate limiting logged-out requests without storing IP addresses. The address is hashed with a key that
// changes every UTC day (derived from a Worker secret), so a stored hash can't be turned back into an
// address without the secret, and hashes from different days can't be linked to each other.

import { hmacSha256Hex } from './crypto.ts';

/**
 * The part of an address that identifies one sender: an IPv4 address as is, an IPv6 address cut to its
 * /64 (a household or a phone usually holds a whole /64, so the full address would be trivial to rotate).
 */
export function ipBucket(raw: string | null | undefined): string {
  const ip = (raw ?? '').trim().toLowerCase();
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const halves = ip.split('::');
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** 64 hex characters, the same for one sender all day (UTC) and unrelated to the next day's. */
export async function dailyIpHash(secret: string, ip: string | null | undefined, now: Date = new Date()): Promise<string> {
  const dayKey = await hmacSha256Hex(secret, `ip-hash:${now.toISOString().slice(0, 10)}`);
  return hmacSha256Hex(dayKey, ipBucket(ip));
}
