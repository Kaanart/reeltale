// Public media (episode posters, series covers) lives in the MEDIA R2 bucket behind its own domain
// (lib/env.ts MEDIA_ORIGIN, the same as the Worker's), which only ever holds approved media. Pure (tested in
// src/core/__tests__/watch-logic.test.ts).

/** Production media domain; screens pass lib/env.ts MEDIA_ORIGIN (env.ts needs React Native, so not imported here). */
export const DEFAULT_MEDIA_ORIGIN = 'https://media.reeltale.net';

// Keys are written by the Worker and checked by SQL ("public/posters/<episode>/<asset>.jpg", "public/covers/…"):
// plain path segments under public/, nothing that could leave the bucket's public folder.
const KEY = /^public(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

/** The https URL of a media key, or null for a missing or odd-looking key. */
export function mediaUrl(key: string | null | undefined, origin: string = DEFAULT_MEDIA_ORIGIN): string | null {
  if (!key || key.length > 512 || !KEY.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
    return null;
  }
  const base = origin.replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base)) return null;
  return `${base}/${key}`;
}
