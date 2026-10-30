// Cloudflare Stream media for the ingest workflow: still and animated thumbnails, AI-generated
// captions, and deleting a video. Shapes follow developers.cloudflare.com/stream (checked 2026-10-28):
//   thumbnails  https://customer-<code>.cloudflarestream.com/<uid or signed token>/thumbnails/thumbnail.jpg|gif
//               (every ReelTale video requires signed URLs, so a short-lived token replaces the uid)
//   captions    POST …/stream/<uid>/captions/<lang>/generate, GET …/stream/<uid>/captions (status
//               inprogress | ready | error), GET …/stream/<uid>/captions/<lang>/vtt
//   delete      DELETE …/stream/<uid>

export const STREAM_UID = /^[a-f0-9]{32}$/;

/** Languages Stream can generate captions in. */
export const CAPTION_LANGUAGES = ['cs', 'nl', 'en', 'fr', 'de', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'es'] as const;

export const MAX_JPEG_BYTES = 2 * 1024 * 1024;
export const MAX_GIF_BYTES = 8 * 1024 * 1024;
const MAX_VTT_BYTES = 1024 * 1024;

export class StreamApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ThumbnailOptions {
  /** Seconds into the video (whole seconds). */
  time: number;
  width: number;
  height: number;
  /** crop fills the box and trims; clip keeps the whole frame inside the box. */
  fit: 'crop' | 'clip';
  /** An animated GIF instead of a still JPEG. */
  animated?: { duration: number; fps: number };
}

export function thumbnailUrl(customerCode: string, tokenOrUid: string, o: ThumbnailOptions): string {
  const q = new URLSearchParams({
    time: `${Math.max(0, Math.floor(o.time))}s`, width: String(o.width), height: String(o.height), fit: o.fit,
  });
  if (o.animated) {
    q.set('duration', `${o.animated.duration}s`);
    q.set('fps', String(o.animated.fps));
  }
  return `https://customer-${customerCode}.cloudflarestream.com/${tokenOrUid}/thumbnails/thumbnail.${o.animated ? 'gif' : 'jpg'}?${q}`;
}

function looksLike(bytes: Uint8Array, kind: 'jpeg' | 'gif'): boolean {
  if (kind === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return String.fromCharCode(...bytes.subarray(0, 4)) === 'GIF8';
}

/**
 * Download one thumbnail. The bytes end up in a public bucket on our domain, so only a real JPEG or GIF
 * of a bounded size is accepted, whatever the response claims to be.
 */
export async function fetchImage(url: string, kind: 'jpeg' | 'gif', fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const max = kind === 'gif' ? MAX_GIF_BYTES : MAX_JPEG_BYTES;
  const res = await fetchImpl(url);
  if (!res.ok) throw new StreamApiError(res.status, `stream thumbnail failed (${res.status})`);
  if (Number(res.headers.get('Content-Length') ?? 0) > max) throw new StreamApiError(502, 'stream thumbnail too large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > max) throw new StreamApiError(502, 'stream thumbnail too large');
  if (!looksLike(bytes, kind)) throw new StreamApiError(502, `stream thumbnail is not a ${kind}`);
  return bytes;
}

export interface StreamApi {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}

function call(api: StreamApi, uid: string, path: string, method: 'GET' | 'POST' | 'DELETE'): Promise<Response> {
  // The uid goes into the URL path: only Stream's own 32-hex format is accepted.
  if (!STREAM_UID.test(uid)) throw new StreamApiError(400, 'invalid stream uid');
  const f = api.fetchImpl ?? fetch;
  return f(`https://api.cloudflare.com/client/v4/accounts/${api.accountId}/stream/${uid}${path}`, {
    method, headers: { Authorization: `Bearer ${api.apiToken}` },
  });
}

function checkLanguage(lang: string): string {
  if (!(CAPTION_LANGUAGES as readonly string[]).includes(lang)) throw new StreamApiError(400, 'unsupported caption language');
  return lang;
}

export type CaptionState = 'ready' | 'inprogress' | 'error' | 'missing';

/** The state of the video's caption in one language ('missing' if there is none). */
export async function captionState(api: StreamApi, uid: string, lang: string): Promise<CaptionState> {
  checkLanguage(lang);
  const res = await call(api, uid, '/captions', 'GET');
  const body = (await res.json().catch(() => null)) as { success?: boolean; result?: { language?: string; status?: string }[] } | null;
  if (!res.ok || !body?.success || !Array.isArray(body.result)) throw new StreamApiError(res.status, `stream captions failed (${res.status})`);
  const c = body.result.find((x) => x.language === lang);
  if (!c) return 'missing';
  // Uploaded (not generated) captions have no status: they are ready.
  if (c.status === undefined || c.status === 'ready') return 'ready';
  return c.status === 'inprogress' ? 'inprogress' : 'error';
}

/**
 * Ask Stream to generate captions in the video's spoken language. Returns false if Stream refused and has
 * no caption in that language either. A caption that already exists (a retried step) counts as started.
 */
export async function generateCaptions(api: StreamApi, uid: string, lang: string): Promise<boolean> {
  checkLanguage(lang);
  const res = await call(api, uid, `/captions/${lang}/generate`, 'POST');
  if (res.ok) return true;
  return (await captionState(api, uid, lang)) !== 'missing';
}

export async function captionVtt(api: StreamApi, uid: string, lang: string): Promise<string> {
  checkLanguage(lang);
  const res = await call(api, uid, `/captions/${lang}/vtt`, 'GET');
  if (!res.ok) throw new StreamApiError(res.status, `stream caption download failed (${res.status})`);
  const text = await res.text();
  if (text.length > MAX_VTT_BYTES) throw new StreamApiError(502, 'stream caption too large');
  return text;
}

/** Delete a video. A video that is already gone counts as deleted. */
export async function deleteVideo(api: StreamApi, uid: string): Promise<'deleted' | 'gone'> {
  const res = await call(api, uid, '', 'DELETE');
  if (res.ok) return 'deleted';
  if (res.status === 404) return 'gone';
  throw new StreamApiError(res.status, `stream delete failed (${res.status})`);
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };

/** The spoken text of a WebVTT file: cue text only, tags removed, repeated cues once, at most `max` characters. */
export function vttToText(vtt: string, max = 3000): string {
  const out: string[] = [];
  for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;  // the header, NOTE, STYLE and REGION blocks
    const text = lines.slice(at + 1).join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|nbsp|quot|#39);/g, (m) => ENTITIES[m] ?? m)
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text !== out.at(-1)) out.push(text);
  }
  return out.join(' ').slice(0, max);
}
