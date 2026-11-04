// Voice capture for "Say your choice" (story player, web first): the microphone's float samples become 16 kHz
// mono 16-bit PCM in a WAV file, the format Muse Voice Transcribe takes. The Worker checks every upload with
// the same rules before it goes anywhere (apps/server/src/routes/voice.ts checkWav; a server test builds its
// WAVs with encodeWav below, so the two can't drift apart).
//
// Pure: no DOM, no React, no timers. The browser part (getUserMedia, AudioWorklet) is in
// src/features/story/voice/webRecorder.ts and only hands chunks of samples to PcmCollector.

/** What the app sends: 16 kHz, one channel, 16-bit signed little-endian PCM. */
export const VOICE_SAMPLE_RATE = 16_000;
/** The longest recording the app makes. The Worker allows a little more (10 s) for slack. */
export const VOICE_MAX_MS = 8_000;
/** Shorter than this is a tap, not speech: the app doesn't send it. */
export const VOICE_MIN_MS = 300;
/** The Worker refuses a body over this. 8 s at 16 kHz is about 250 KB. */
export const VOICE_MAX_BYTES = 600 * 1024;
export const WAV_HEADER_BYTES = 44;

/** The limits checkWav applies. The Worker's: 8–48 kHz, at most 10 s. */
export interface WavLimits {
  minRate: number;
  maxRate: number;
  minMs: number;
  maxMs: number;
}

export const SERVER_WAV_LIMITS: WavLimits = { minRate: 8_000, maxRate: 48_000, minMs: 100, maxMs: 10_000 };

// ---- Samples ---------------------------------------------------------------------------------------

/** The average of the channels, sample by sample (the shortest channel sets the length). */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!.slice();
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const c of channels) sum += c[i]!;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Resample mono samples from `inRate` to `outRate`. Going down (48 kHz to 16 kHz, the usual case), each output
 * sample is the average of the input samples it covers: a cheap low-pass that keeps speech clear and stops the
 * worst aliasing. Going up (an 8 kHz microphone), straight-line interpolation.
 */
export function resample(input: Float32Array, inRate: number, outRate: number = VOICE_SAMPLE_RATE): Float32Array {
  if (!(inRate > 0) || !(outRate > 0)) throw new RangeError('sample rates must be positive');
  if (inRate === outRate || input.length === 0) return input.slice();
  const ratio = inRate / outRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.min(input.length, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j]!;
      out[i] = sum / (to - from);
    }
  } else {
    for (let i = 0; i < length; i++) {
      const at = i * ratio;
      const j = Math.floor(at);
      const next = Math.min(input.length - 1, j + 1);
      const f = at - j;
      out[i] = input[j]! * (1 - f) + input[next]! * f;
    }
  }
  return out;
}

/** Floats in [-1, 1] to 16-bit integers; anything outside is clipped, NaN becomes silence. */
export function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const v = Number.isNaN(s) ? 0 : Math.max(-1, Math.min(1, s));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

/** Root mean square of a chunk (0 silence .. 1 full scale), for the recording level meter. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.min(1, Math.sqrt(sum / samples.length));
}

// ---- WAV -----------------------------------------------------------------------------------------------

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** A 44-byte RIFF/WAVE header (PCM, mono, 16-bit) followed by the samples, little-endian. */
export function encodeWav(pcm: Int16Array, sampleRate: number = VOICE_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sample rate must be a positive integer');
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(WAV_HEADER_BYTES + i * 2, pcm[i]!, true);
  return new Uint8Array(buffer);
}

export type WavProblem =
  | 'too_small'      // shorter than a header
  | 'not_riff'
  | 'not_wave'
  | 'no_fmt'         // no format chunk before the data
  | 'not_pcm'        // compressed or "extensible" audio
  | 'not_mono'
  | 'not_16bit'
  | 'bad_rate'       // outside the limits, or a header that contradicts itself
  | 'no_data'
  | 'truncated'      // the data chunk says it is longer than the file
  | 'too_short'
  | 'too_long';

export type WavCheck =
  | { ok: true; sampleRate: number; dataBytes: number; durationMs: number }
  | { ok: false; problem: WavProblem };

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

/**
 * Is this a WAV file the transcription accepts: RIFF/WAVE, plain PCM, one channel, 16 bits, a sample rate within
 * the limits, and a length within them? Chunks other than `fmt ` and `data` (LIST, fact ...) are skipped. The
 * data chunk's declared size counts, and it must fit in the file.
 */
export function checkWav(bytes: Uint8Array, limits: WavLimits = SERVER_WAV_LIMITS): WavCheck {
  const fail = (problem: WavProblem): WavCheck => ({ ok: false, problem });
  if (bytes.length < WAV_HEADER_BYTES) return fail('too_small');
  if (ascii(bytes, 0) !== 'RIFF') return fail('not_riff');
  if (ascii(bytes, 8) !== 'WAVE') return fail('not_wave');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let format: { rate: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return fail('no_fmt');
      const audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const byteRate = view.getUint32(body + 8, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bits = view.getUint16(body + 14, true);
      if (audioFormat !== 1) return fail('not_pcm');
      if (channels !== 1) return fail('not_mono');
      if (bits !== 16 || blockAlign !== 2) return fail('not_16bit');
      if (rate < limits.minRate || rate > limits.maxRate || byteRate !== rate * 2) return fail('bad_rate');
      format = { rate };
    } else if (id === 'data') {
      if (!format) return fail('no_fmt');
      if (size === 0) return fail('no_data');
      if (body + size > bytes.length) return fail('truncated');
      const durationMs = Math.round(((size / 2) / format.rate) * 1000);
      if (durationMs < limits.minMs) return fail('too_short');
      if (durationMs > limits.maxMs) return fail('too_long');
      return { ok: true, sampleRate: format.rate, dataBytes: size, durationMs };
    }
    // Chunks are padded to an even length.
    offset = body + size + (size % 2);
  }
  return fail(format ? 'no_data' : 'no_fmt');
}

// ---- Collecting a recording ------------------------------------------------------------------------------

/**
 * The samples of one recording, as the microphone delivers them (at the audio context's rate, often 48 kHz),
 * kept up to `maxMs`. `push` returns false once the recording is full (the recorder stops then). `toWav`
 * makes the 16 kHz mono file.
 */
export class PcmCollector {
  readonly inputRate: number;
  readonly maxSamples: number;
  private readonly chunks: Float32Array[] = [];
  private count = 0;

  constructor(inputRate: number, maxMs: number = VOICE_MAX_MS) {
    if (!(inputRate > 0)) throw new RangeError('input rate must be positive');
    this.inputRate = inputRate;
    this.maxSamples = Math.floor((inputRate * maxMs) / 1000);
  }

  /** Keeps a copy of (the part that fits of) `chunk`. False when the recording is full. */
  push(chunk: Float32Array): boolean {
    const room = this.maxSamples - this.count;
    if (room > 0 && chunk.length > 0) {
      const take = chunk.length <= room ? chunk.slice() : chunk.slice(0, room);
      this.chunks.push(take);
      this.count += take.length;
    }
    return this.count < this.maxSamples;
  }

  get full(): boolean {
    return this.count >= this.maxSamples;
  }

  get durationMs(): number {
    return Math.round((this.count / this.inputRate) * 1000);
  }

  /** Everything so far as one 16 kHz mono 16-bit WAV file. */
  toWav(outRate: number = VOICE_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
    const all = new Float32Array(this.count);
    let at = 0;
    for (const c of this.chunks) {
      all.set(c, at);
      at += c.length;
    }
    return encodeWav(floatTo16BitPcm(resample(all, this.inputRate, outRate)), outRate);
  }
}
