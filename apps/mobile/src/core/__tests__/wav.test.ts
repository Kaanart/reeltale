import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWav, encodeWav, floatTo16BitPcm, mixToMono, PcmCollector, resample, rms, SERVER_WAV_LIMITS, VOICE_MAX_BYTES,
  VOICE_MAX_MS, VOICE_SAMPLE_RATE, WAV_HEADER_BYTES,
} from '../wav.ts';

// The voice recording's file format (src/core/wav.ts): what "Say your choice" sends to the Worker.

const tone = (rate: number, ms: number, hz = 440, amp = 0.5) =>
  Float32Array.from({ length: Math.round((rate * ms) / 1000) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

function u32(bytes: Uint8Array, at: number) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
}
function u16(bytes: Uint8Array, at: number) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);
}
const text = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.slice(at, at + 4));

test('encodeWav writes a 44-byte PCM mono 16-bit header and the samples little-endian', () => {
  const wav = encodeWav(Int16Array.from([0, 1, -1, 32767, -32768]), 16_000);
  assert.equal(wav.length, WAV_HEADER_BYTES + 10);
  assert.equal(text(wav, 0), 'RIFF');
  assert.equal(u32(wav, 4), 36 + 10);
  assert.equal(text(wav, 8), 'WAVE');
  assert.equal(text(wav, 12), 'fmt ');
  assert.equal(u32(wav, 16), 16);
  assert.equal(u16(wav, 20), 1, 'PCM');
  assert.equal(u16(wav, 22), 1, 'mono');
  assert.equal(u32(wav, 24), 16_000);
  assert.equal(u32(wav, 28), 32_000, 'bytes per second');
  assert.equal(u16(wav, 32), 2);
  assert.equal(u16(wav, 34), 16);
  assert.equal(text(wav, 36), 'data');
  assert.equal(u32(wav, 40), 10);
  assert.deepEqual([...wav.slice(44)], [0, 0, 1, 0, 0xff, 0xff, 0xff, 0x7f, 0x00, 0x80]);
  assert.throws(() => encodeWav(new Int16Array(1), 0));
  assert.throws(() => encodeWav(new Int16Array(1), 16_000.5));
});

test('floats become 16-bit samples, clipped, NaN as silence', () => {
  assert.deepEqual([...floatTo16BitPcm(Float32Array.from([0, 1, -1, 2, -2, 0.5, Number.NaN]))], [0, 32767, -32768, 32767, -32768, 16384, 0]);
});

test('channels mix to their average; one channel is copied', () => {
  const left = Float32Array.from([1, 0, 0.5]);
  const right = Float32Array.from([0, 1, 0.5, 9]);
  assert.deepEqual([...mixToMono([left, right])], [0.5, 0.5, 0.5]);
  const one = mixToMono([left]);
  assert.deepEqual([...one], [...left]);
  assert.notEqual(one, left, 'a copy');
  assert.equal(mixToMono([]).length, 0);
});

test('48 kHz goes down to 16 kHz by averaging, keeping the length and a low tone', () => {
  const input = tone(48_000, 1000, 440);
  const out = resample(input, 48_000, 16_000);
  assert.equal(out.length, 16_000);
  // A 440 Hz tone survives with about the same level.
  assert.ok(Math.abs(rms(out) - rms(input)) < 0.01, `${rms(out)} vs ${rms(input)}`);
  // A tone near the old Nyquist (20 kHz) is mostly averaged away instead of folding into speech frequencies.
  const hiss = resample(tone(48_000, 1000, 20_000), 48_000, 16_000);
  assert.ok(rms(hiss) < 0.15, `${rms(hiss)}`);
  // Exactly three input samples per output sample.
  assert.deepEqual([...resample(Float32Array.from([3, 3, 3, 6, 6, 6]), 48_000, 16_000)], [3, 6]);
});

test('odd rates and upsampling work; the same rate is a copy', () => {
  assert.equal(resample(tone(44_100, 500), 44_100, 16_000).length, 8000);
  const up = resample(Float32Array.from([0, 1]), 8000, 16_000);
  assert.deepEqual([...up], [0, 0.5, 1, 1]);
  const same = Float32Array.from([1, 2]);
  assert.deepEqual([...resample(same, 16_000, 16_000)], [1, 2]);
  assert.throws(() => resample(same, 0, 16_000));
});

test('rms: silence is 0, a full square wave 1', () => {
  assert.equal(rms(new Float32Array(10)), 0);
  assert.equal(rms(Float32Array.from([1, -1, 1, -1])), 1);
  assert.equal(rms(new Float32Array(0)), 0);
});

test('the collector keeps at most 8 s and makes a 16 kHz WAV the server accepts', () => {
  const c = new PcmCollector(48_000, VOICE_MAX_MS);
  const block = tone(48_000, 100);
  let pushes = 0;
  while (c.push(block)) pushes += 1;
  assert.equal(pushes, 79, 'the 80th block fills it');
  assert.equal(c.full, true);
  assert.equal(c.durationMs, VOICE_MAX_MS);
  assert.equal(c.push(block), false, 'nothing more fits');
  const wav = c.toWav();
  assert.equal(wav.length, WAV_HEADER_BYTES + VOICE_SAMPLE_RATE * 2 * (VOICE_MAX_MS / 1000));
  assert.ok(wav.length < VOICE_MAX_BYTES);
  const check = checkWav(wav);
  assert.deepEqual(check, { ok: true, sampleRate: 16_000, dataBytes: 256_000, durationMs: 8000 });
});

test('the collector copies what it is given (a recorder reuses its buffers)', () => {
  const c = new PcmCollector(16_000, 1000);
  const buf = Float32Array.from({ length: 160 }, () => 0.25);
  c.push(buf);
  buf.fill(0);
  const wav = c.toWav();
  assert.equal(new DataView(wav.buffer).getInt16(44, true), 8192);
  assert.equal(new PcmCollector(16_000).toWav().length, WAV_HEADER_BYTES, 'an empty recording is a header only');
  assert.throws(() => new PcmCollector(0));
});

function wavWith(over: { format?: number; channels?: number; rate?: number; bits?: number; dataBytes?: number; truncate?: number } = {}) {
  const rate = over.rate ?? 16_000;
  const wav = encodeWav(new Int16Array(rate / 2), rate);
  const view = new DataView(wav.buffer);
  if (over.format !== undefined) view.setUint16(20, over.format, true);
  if (over.channels !== undefined) view.setUint16(22, over.channels, true);
  if (over.bits !== undefined) view.setUint16(34, over.bits, true);
  if (over.dataBytes !== undefined) view.setUint32(40, over.dataBytes, true);
  return over.truncate ? wav.slice(0, wav.length - over.truncate) : wav;
}

test('checkWav accepts only RIFF/WAVE PCM16 mono at 8 to 48 kHz, 0.1 to 10 s', () => {
  assert.equal(checkWav(wavWith()).ok, true);
  assert.equal(checkWav(wavWith({ rate: 8000 })).ok, true);
  assert.equal(checkWav(wavWith({ rate: 48_000 })).ok, true);
  const bad: [Uint8Array, string][] = [
    [new Uint8Array(10), 'too_small'],
    [wavWith({ format: 3 }), 'not_pcm'],
    [wavWith({ format: 0xfffe }), 'not_pcm'],
    [wavWith({ channels: 2 }), 'not_mono'],
    [wavWith({ bits: 8 }), 'not_16bit'],
    [wavWith({ rate: 6000 }), 'bad_rate'],
    [wavWith({ rate: 96_000 }), 'bad_rate'],
    [wavWith({ dataBytes: 0 }), 'no_data'],
    [wavWith({ truncate: 2 }), 'truncated'],
    [encodeWav(new Int16Array(16 * 50)), 'too_short'],
    [encodeWav(new Int16Array(16_000 * 11)), 'too_long'],
  ];
  for (const [bytes, problem] of bad) assert.deepEqual(checkWav(bytes), { ok: false, problem }, problem);
  const riff = wavWith();
  riff.set([0x52, 0x49, 0x46, 0x58], 0); // RIFX
  assert.deepEqual(checkWav(riff), { ok: false, problem: 'not_riff' });
  const avi = wavWith();
  avi.set([0x41, 0x56, 0x49, 0x20], 8);
  assert.deepEqual(checkWav(avi), { ok: false, problem: 'not_wave' });
  const liar = wavWith();
  new DataView(liar.buffer).setUint32(28, 1, true); // byte rate that contradicts the sample rate
  assert.deepEqual(checkWav(liar), { ok: false, problem: 'bad_rate' });
});

test('checkWav skips other chunks, honours padding, and needs fmt before data', () => {
  const plain = encodeWav(new Int16Array(16_000));
  // RIFF header, then a LIST chunk of odd length (padded), then fmt and data.
  const list = Uint8Array.from([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0]);
  const withList = new Uint8Array(plain.length + list.length);
  withList.set(plain.slice(0, 12), 0);
  withList.set(list, 12);
  withList.set(plain.slice(12), 12 + list.length);
  assert.deepEqual(checkWav(withList), { ok: true, sampleRate: 16_000, dataBytes: 32_000, durationMs: 1000 });

  // data before fmt
  const swapped = new Uint8Array(plain.length);
  swapped.set(plain.slice(0, 12), 0);
  swapped.set(plain.slice(36, 44), 12);
  swapped.set(plain.slice(12, 36), 20);
  assert.deepEqual(checkWav(swapped), { ok: false, problem: 'no_fmt' });

  // fmt but no data chunk at all
  assert.deepEqual(checkWav(Uint8Array.from([...plain.slice(0, 36), ...new Uint8Array(8)])), { ok: false, problem: 'no_data' });
  // A Uint8Array view into a larger buffer is read at its own offset.
  const padded = new Uint8Array(plain.length + 7);
  padded.set(plain, 7);
  assert.equal(checkWav(padded.subarray(7)).ok, true);
  assert.equal(SERVER_WAV_LIMITS.maxMs, 10_000);
});
