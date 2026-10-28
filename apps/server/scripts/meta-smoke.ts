// Live smoke test of the Meta Model API with our real client: run once META_API_KEY is in
// ~/.config/reeltale/secrets.env. Prints timings and pass/fail only; never prints the key. Images are
// written to the output folder (default: a temp dir) so a person can look at them.
//
//   node apps/server/scripts/meta-smoke.ts [outDir]
//
// Costs about $0.10 (a few Spark calls, one Wonder call, 3 images, 1 SAM call, a 1-second ASR call).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createMetaClient, MetaApiError } from '../src/ai/meta.ts';

function readSecret(name: string): string {
  const file = join(homedir(), '.config', 'reeltale', 'secrets.env');
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') ?? '';
  if (!value) throw new Error(`${name} is empty in ${file}`);
  return value;
}

const out = process.argv[2] ?? join(tmpdir(), `reeltale-smoke-${Date.now()}`);
mkdirSync(out, { recursive: true });
const meta = createMetaClient({ apiKey: readSecret('META_API_KEY'), endUserId: 'smoke-test' });
const results: { step: string; ok: boolean; ms: number; note: string }[] = [];

async function step<T>(name: string, fn: () => Promise<T>, note: (v: T) => string = () => ''): Promise<T | null> {
  const t0 = performance.now();
  try {
    const v = await fn();
    results.push({ step: name, ok: true, ms: Math.round(performance.now() - t0), note: note(v) });
    return v;
  } catch (e) {
    const msg = e instanceof MetaApiError ? `${e.status} ${e.code}: ${e.message}` : String(e);
    results.push({ step: name, ok: false, ms: Math.round(performance.now() - t0), note: msg.slice(0, 200) });
    return null;
  }
}

/** One second of 16 kHz mono 16-bit silence as WAV (checks the format is accepted). */
function silentWav(): Uint8Array {
  const n = 16000;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return new Uint8Array(buf);
}

await step('spark json schema', () => meta.chatJson({
  model: 'muse-spark-1.3', schemaName: 'ping', effort: 'low', system: 'Answer briefly.', user: 'Name a colour and a number from 1 to 5.',
  schema: z.object({ colour: z.string(), number: z.number().int().min(1).max(5) }),
}), (r) => JSON.stringify(r.data));

await step('wonder json schema', () => meta.chatJson({
  model: 'muse-wonder-1.0', schemaName: 'ping', effort: 'low', system: 'Answer briefly.', user: 'Give a one-line story premise about a lighthouse.',
  schema: z.object({ premise: z.string().max(200) }),
}), (r) => r.data.premise.slice(0, 80));

const img = await step('muse image 9:16 (fast)', () => meta.generateImage({
  prompt: 'Ink and watercolor comic panel, vertical 9:16, an adult lighthouse keeper in a navy coat on wet rocks at dusk. No text.',
  size: '1080x1920', fast: true,
}), (b) => `${b.length} bytes`);
if (img) writeFileSync(join(out, 'panel.webp'), img);

await step('muse image 9:16 (high)', () => meta.generateImage({
  prompt: 'Ink and watercolor comic panel, vertical 9:16, a storm over a lighthouse. No text.', size: '1080x1920',
}), (b) => `${b.length} bytes`).then((b) => b && writeFileSync(join(out, 'panel-high.webp'), b));

if (img) {
  const url = `data:image/webp;base64,${Buffer.from(img).toString('base64')}`;
  await step('muse image clean plate (edit)', () => meta.editImage({
    prompt: 'Remove every person from this image and fill in the background behind them. No text.', images: [url], size: '1080x1920', fast: true,
  }), (b) => `${b.length} bytes`).then((b) => b && writeFileSync(join(out, 'plate.webp'), b));
  await step('sam 3.1 boxes', () => meta.segmentBoxes({ phrase: 'person', imageUrl: url }), (boxes) => JSON.stringify(boxes.slice(0, 2)));
}

await step('voice transcribe (1 s silent WAV)', () => meta.transcribe({ wav: silentWav(), languages: ['English'] }), (t) => `"${t.transcript}" ${t.audioDurationMs} ms`);

console.table(results);
console.log(`Images in ${out}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
