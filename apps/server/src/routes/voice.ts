// POST /api/ai/transcribe: "Say your choice" in the AI story player (web first). Signed-in adults only (the
// auth, per-user and AI rate-limit middleware in app.ts cover /api/ai/*).
//
// The app records at most 8 s of 16 kHz mono PCM16 and sends it as audio/wav (apps/mobile/src/core/wav.ts).
// Here, in order and before anything costs money:
//   1. Content-Type audio/wav, at most 600 KB (Content-Length and the bytes actually read)
//   2. a real RIFF/WAVE header: plain PCM, mono, 16-bit, 8-48 kHz, 0.1-10 s (checkWav, the same rules as the app)
//   3. svc.voice_allowed: a live adult who has allowed voice input for Meta
//   4. Meta's Muse Voice Transcribe (ai/meta.ts transcribe, model muse-voice-transcribe-1.0)
// and the answer is { text } only. The audio exists only in this request's memory: it is never written to R2,
// the database or a log. Logs carry the audio length, the text length and the latency, nothing said.

import { Hono } from 'hono';
import type { AppContext, Env } from '../env.ts';
import { createMetaClient, MetaApiError, type MetaClient } from '../ai/meta.ts';
import { serviceDb } from '../lib/db.ts';
import { dbErrorResponse, jsonError } from '../lib/http.ts';

/** The largest body accepted. 10 s at 16 kHz is about 320 KB; 600 KB leaves room for 8 s at higher rates. */
export const VOICE_MAX_BYTES = 600 * 1024;
export const VOICE_LIMITS = { minRate: 8_000, maxRate: 48_000, minMs: 100, maxMs: 10_000 } as const;
/** The text handed back is cut to this (a spoken choice is a few words). */
export const TRANSCRIPT_MAX_CHARS = 500;
/** Meta gets this long before the user is told voice input isn't available. */
export const META_TIMEOUT_MS = 15_000;

export type WavProblem =
  | 'too_small' | 'not_riff' | 'not_wave' | 'no_fmt' | 'not_pcm' | 'not_mono' | 'not_16bit' | 'bad_rate' | 'no_data'
  | 'truncated' | 'too_short' | 'too_long';

export type WavCheck =
  | { ok: true; sampleRate: number; dataBytes: number; durationMs: number }
  | { ok: false; problem: WavProblem };

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

/**
 * Is this a WAV file we send on: RIFF/WAVE, PCM (format 1), one channel, 16 bits, a sample rate and a length
 * within VOICE_LIMITS? Other chunks (LIST, fact ...) are skipped; the data chunk must fit in the body. The app
 * has the same function (apps/mobile/src/core/wav.ts checkWav); test/voice-route.test.ts feeds this one the
 * app's encoder output, so they agree.
 */
export function checkWav(bytes: Uint8Array, limits: typeof VOICE_LIMITS = VOICE_LIMITS): WavCheck {
  const fail = (problem: WavProblem): WavCheck => ({ ok: false, problem });
  if (bytes.length < 44) return fail('too_small');
  if (ascii(bytes, 0) !== 'RIFF') return fail('not_riff');
  if (ascii(bytes, 8) !== 'WAVE') return fail('not_wave');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate: number | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return fail('no_fmt');
      if (view.getUint16(body, true) !== 1) return fail('not_pcm');
      if (view.getUint16(body + 2, true) !== 1) return fail('not_mono');
      if (view.getUint16(body + 14, true) !== 16 || view.getUint16(body + 12, true) !== 2) return fail('not_16bit');
      const r = view.getUint32(body + 4, true);
      if (r < limits.minRate || r > limits.maxRate || view.getUint32(body + 8, true) !== r * 2) return fail('bad_rate');
      rate = r;
    } else if (id === 'data') {
      if (rate === null) return fail('no_fmt');
      if (size === 0) return fail('no_data');
      if (body + size > bytes.length) return fail('truncated');
      const durationMs = Math.round(((size / 2) / rate) * 1000);
      if (durationMs < limits.minMs) return fail('too_short');
      if (durationMs > limits.maxMs) return fail('too_long');
      return { ok: true, sampleRate: rate, dataBytes: size, durationMs };
    }
    offset = body + size + (size % 2);
  }
  return fail(rate === null ? 'no_fmt' : 'no_data');
}

/** The body as bytes, or null when it is over `max` (stops reading at once, never buffers more than `max`). */
export async function readCappedBytes(req: Request, max: number): Promise<Uint8Array | null> {
  if (Number(req.headers.get('Content-Length') ?? 0) > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** The media type without parameters, lower case: `audio/wav; codecs=1` is `audio/wav`. */
function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

/** Whitespace folded, control characters dropped, cut to TRANSCRIPT_MAX_CHARS. */
export function cleanTranscript(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TRANSCRIPT_MAX_CHARS);
}

/** What a failed Meta call becomes for the app. Nothing of Meta's message is passed on. */
export function metaFailure(err: unknown): { status: 422 | 503; error: 'audio_unreadable' | 'transcribe_unavailable'; log: string } {
  if (err instanceof MetaApiError) {
    if (err.code === 'content_policy' || err.status === 400 || err.status === 413 || err.status === 415 || err.status === 422) {
      return { status: 422, error: 'audio_unreadable', log: `meta ${err.status} ${err.code}` };
    }
    return { status: 503, error: 'transcribe_unavailable', log: `meta ${err.status} ${err.code}` };
  }
  const name = err instanceof Error ? err.name : 'unknown';
  return { status: 503, error: 'transcribe_unavailable', log: `meta request ${name === 'TimeoutError' || name === 'AbortError' ? 'timed out' : 'failed'}` };
}

/** Meta's client with a time limit on every request. */
function metaClient(env: Env & { META_API_KEY: string }): MetaClient {
  return createMetaClient({
    apiKey: env.META_API_KEY,
    fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(META_TIMEOUT_MS) }),
  });
}

export const voiceRoutes = new Hono<AppContext>();

voiceRoutes.post('/transcribe', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (mediaType(c.req.header('Content-Type')) !== 'audio/wav') return jsonError(c, 415, 'unsupported_media_type');
  const wav = await readCappedBytes(c.req.raw, VOICE_MAX_BYTES);
  if (wav === null) return jsonError(c, 413, 'audio_too_large');
  const check = checkWav(wav);
  if (!check.ok) return jsonError(c, 400, check.problem === 'too_long' ? 'audio_too_long' : 'bad_audio');

  const env = c.env;
  const apiKey = env.META_API_KEY;
  if (!apiKey) return jsonError(c, 503, 'transcribe_unavailable');

  let allowed: boolean;
  try {
    allowed = (await serviceDb(env).rpc<boolean>('voice_allowed', { p_user: c.get('userId') })) === true;
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  if (!allowed) return jsonError(c, 403, 'voice_consent_required');

  const started = Date.now();
  let text: string;
  try {
    const result = await metaClient({ ...env, META_API_KEY: apiKey }).transcribe({ wav });
    text = cleanTranscript(result.transcript);
  } catch (err) {
    const failure = metaFailure(err);
    console.error('transcribe failed', JSON.stringify({ reason: failure.log, audio_ms: check.durationMs, latency_ms: Date.now() - started }));
    return jsonError(c, failure.status, failure.error);
  }
  console.log('transcribe', JSON.stringify({ audio_ms: check.durationMs, text_chars: text.length, latency_ms: Date.now() - started }));
  return c.json({ text });
});
