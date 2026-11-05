import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetAssetSizes, parseRange, sliceStream, withByteRanges } from '../src/lib/range.ts';
import worker from '../src/app.ts';
import type { Env } from '../src/env.ts';

const BYTES = Uint8Array.from({ length: 100 }, (_, i) => i);

/** The body as a stream of small chunks, like the assets service sends it. */
function chunked(bytes: Uint8Array, size = 7): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

function asset(over: HeadersInit = {}): Response {
  return new Response(chunked(BYTES), {
    status: 200,
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(BYTES.length), ETag: '"v1"', ...over },
  });
}

const get = (range?: string, extra: Record<string, string> = {}, method = 'GET') =>
  new Request('https://reeltale.net/assets/ep.mp4', { method, headers: { ...(range ? { Range: range } : {}), ...extra } });

test('parseRange: one range, open ends, suffixes, and what falls back to the whole body', () => {
  assert.deepEqual(parseRange('bytes=0-1', 100), { start: 0, end: 1 });
  assert.deepEqual(parseRange('bytes=10-', 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 }, 'end clamped to the size');
  assert.deepEqual(parseRange('bytes=-20', 100), { start: 80, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.equal(parseRange(null, 100), null);
  assert.equal(parseRange('bytes=0-1,5-9', 100), null, 'several ranges: whole body');
  assert.equal(parseRange('items=0-1', 100), null);
  assert.equal(parseRange('bytes=9-2', 100), null, 'malformed: whole body');
  assert.equal(parseRange('bytes=-', 100), null);
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
});

test('sliceStream skips and cuts across chunk boundaries', async () => {
  const out = new Uint8Array(await new Response(sliceStream(chunked(BYTES), 12, 30)).arrayBuffer());
  assert.deepEqual([...out], [...BYTES.slice(12, 42)]);
  const tail = new Uint8Array(await new Response(sliceStream(chunked(BYTES), 95, 50)).arrayBuffer());
  assert.deepEqual([...tail], [95, 96, 97, 98, 99], 'stops at the end of the body');
});

test('withByteRanges: 206 with only the asked bytes, the right headers, and Safari’s first probe', async () => {
  const res = await withByteRanges(get('bytes=10-19'), asset());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), 'bytes 10-19/100');
  assert.equal(res.headers.get('Content-Length'), '10');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Content-Type'), 'video/mp4');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...BYTES.slice(10, 20)]);

  const probe = await withByteRanges(get('bytes=0-1'), asset());
  assert.equal(probe.status, 206);
  assert.deepEqual([...new Uint8Array(await probe.arrayBuffer())], [0, 1]);
});

test('withByteRanges: whole file says Accept-Ranges; 416 past the end; HEAD has no body', async () => {
  const whole = await withByteRanges(get(), asset());
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, 100);

  const past = await withByteRanges(get('bytes=200-'), asset());
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('Content-Range'), 'bytes */100');

  const head = await withByteRanges(get('bytes=0-9', {}, 'HEAD'), new Response(null, { status: 200, headers: { 'Content-Length': '100' } }));
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('Content-Range'), 'bytes 0-9/100');
  assert.equal(head.body, null);
});

test('withByteRanges leaves alone: a stale If-Range, compressed bodies, other statuses and methods', async () => {
  const stale = await withByteRanges(get('bytes=0-9', { 'If-Range': '"v0"' }), asset());
  assert.equal(stale.status, 200, 'the file changed: send all of it');
  assert.equal((await withByteRanges(get('bytes=0-9', { 'If-Range': '"v1"' }), asset())).status, 206);
  assert.equal((await withByteRanges(get('bytes=0-9'), asset({ 'Content-Encoding': 'br' }))).status, 200);
  const missing = new Response('no', { status: 404 });
  assert.equal(await withByteRanges(get('bytes=0-9'), missing), missing);
  assert.equal((await withByteRanges(get('bytes=0-9', {}, 'POST'), asset())).status, 200);
});

test('the Worker answers ranges on static assets, with its security headers', async () => {
  const env = {
    ASSETS: { fetch: async () => asset() },
    APP_ENV: 'development',
    SUPABASE_URL: 'https://example.supabase.co',
    MEDIA_ORIGIN: 'https://media.reeltale.net',
  } as unknown as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const res = await worker.fetch(get('bytes=50-59'), env, ctx);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), 'bytes 50-59/100');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...BYTES.slice(50, 60)]);
});

test('without Content-Length (as the assets binding sends it): read once, remember the size, then stream', async () => {
  forgetAssetSizes();
  const bare = () => new Response(chunked(BYTES), { status: 200, headers: { 'Content-Type': 'video/mp4', ETag: '"v2"' } });
  const first = await withByteRanges(get('bytes=0-1'), bare());
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('Content-Range'), 'bytes 0-1/100');
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [0, 1]);
  // The size is known now, so the next range streams its slice.
  let read = 0;
  const counted = new Response(chunked(BYTES).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) { read += chunk.byteLength; c.enqueue(chunk); },
  })), { status: 200, headers: { 'Content-Type': 'video/mp4', ETag: '"v2"' } });
  const second = await withByteRanges(get('bytes=10-14'), counted);
  assert.equal(second.headers.get('Content-Range'), 'bytes 10-14/100');
  assert.deepEqual([...new Uint8Array(await second.arrayBuffer())], [10, 11, 12, 13, 14]);
  assert.ok(read < 100, `streamed only part of the file (${read} bytes read)`);
  // A new version (new ETag) is read again.
  const v3 = await withByteRanges(get('bytes=-3'), new Response(chunked(BYTES), { status: 200, headers: { ETag: '"v3"' } }));
  assert.equal(v3.headers.get('Content-Range'), 'bytes 97-99/100');
  forgetAssetSizes();
});
