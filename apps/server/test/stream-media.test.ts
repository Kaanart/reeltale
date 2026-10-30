import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captionState, captionVtt, deleteVideo, fetchImage, generateCaptions, MAX_JPEG_BYTES, StreamApiError, thumbnailUrl, vttToText,
} from '../src/lib/stream-media.ts';

const UID = 'c'.repeat(32);

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('Authorization') });
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const api = (f: typeof fetch) => ({ accountId: 'acc', apiToken: 'tok', fetchImpl: f });
const BASE = `https://api.cloudflare.com/client/v4/accounts/acc/stream/${UID}`;

test('thumbnail URLs put the signed token in place of the uid', () => {
  assert.equal(thumbnailUrl('abc123', 'tok.en.sig', { time: 7.9, width: 512, height: 512, fit: 'clip' }),
    'https://customer-abc123.cloudflarestream.com/tok.en.sig/thumbnails/thumbnail.jpg?time=7s&width=512&height=512&fit=clip');
  assert.equal(thumbnailUrl('abc123', 't', { time: 3, width: 270, height: 480, fit: 'crop', animated: { duration: 3, fps: 8 } }),
    'https://customer-abc123.cloudflarestream.com/t/thumbnails/thumbnail.gif?time=3s&width=270&height=480&fit=crop&duration=3s&fps=8');
});

test('only a real JPEG or GIF of a bounded size is accepted as a thumbnail', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const ok = fakeFetch(() => new Response(jpeg));
  assert.deepEqual(await fetchImage('https://x/t.jpg', 'jpeg', ok.f), jpeg);
  await assert.rejects(fetchImage('https://x/t.jpg', 'jpeg', fakeFetch(() => new Response('<html><script>alert(1)</script>')).f), /not a jpeg/);
  await assert.rejects(fetchImage('https://x/t.gif', 'gif', fakeFetch(() => new Response(jpeg)).f), /not a gif/);
  await assert.rejects(fetchImage('https://x/t.jpg', 'jpeg', fakeFetch(() => new Response(new Uint8Array(MAX_JPEG_BYTES + 1).fill(0xff))).f), /too large/);
  await assert.rejects(fetchImage('https://x/t.jpg', 'jpeg', fakeFetch(() => new Response('', { status: 404 })).f),
    (e) => e instanceof StreamApiError && e.status === 404);
});

test('captions: generate, read the state, download the WebVTT', async () => {
  const list = (result: unknown[]) => Response.json({ success: true, result });
  const gen = fakeFetch((url) => url.endsWith('/generate') ? Response.json({ success: true }) : list([]));
  assert.equal(await generateCaptions(api(gen.f), UID, 'en'), true);
  assert.deepEqual(gen.calls, [{ url: `${BASE}/captions/en/generate`, method: 'POST', auth: 'Bearer tok' }]);

  // A retried step finds its caption already there; a refusal with no caption is "not started".
  const again = fakeFetch((url) => url.endsWith('/generate') ? new Response('{}', { status: 409 })
    : list([{ language: 'en', status: 'inprogress', generated: true }]));
  assert.equal(await generateCaptions(api(again.f), UID, 'en'), true);
  const refused = fakeFetch((url) => url.endsWith('/generate') ? new Response('{}', { status: 400 }) : list([]));
  assert.equal(await generateCaptions(api(refused.f), UID, 'en'), false);

  const states = fakeFetch(() => list([{ language: 'de', status: 'error' }, { language: 'en', status: 'ready', generated: true }]));
  assert.equal(await captionState(api(states.f), UID, 'en'), 'ready');
  assert.equal(await captionState(api(states.f), UID, 'de'), 'error');
  assert.equal(await captionState(api(states.f), UID, 'fr'), 'missing');
  await assert.rejects(captionState(api(fakeFetch(() => new Response('', { status: 500 })).f), UID, 'en'), StreamApiError);

  const vtt = fakeFetch(() => new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nHi'));
  assert.equal(await captionVtt(api(vtt.f), UID, 'en'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi');
  assert.equal(vtt.calls[0]!.url, `${BASE}/captions/en/vtt`);
});

test('deleting a video that is already gone counts as deleted; other failures throw', async () => {
  const del = fakeFetch(() => Response.json({ success: true }));
  assert.equal(await deleteVideo(api(del.f), UID), 'deleted');
  assert.deepEqual(del.calls, [{ url: BASE, method: 'DELETE', auth: 'Bearer tok' }]);
  assert.equal(await deleteVideo(api(fakeFetch(() => new Response('', { status: 404 })).f), UID), 'gone');
  await assert.rejects(deleteVideo(api(fakeFetch(() => new Response('', { status: 500 })).f), UID), StreamApiError);
});

test('uids and languages are checked before anything goes into a URL', async () => {
  const none = fakeFetch(() => { throw new Error('must not fetch'); });
  await assert.rejects(deleteVideo(api(none.f), '../../accounts/other'), /invalid stream uid/);
  await assert.rejects(deleteVideo(api(none.f), UID.toUpperCase()), /invalid stream uid/);
  await assert.rejects(generateCaptions(api(none.f), UID, '../x'), /unsupported caption language/);
  await assert.rejects(captionState(api(none.f), UID, 'tr'), /unsupported caption language/);
  assert.equal(none.calls.length, 0);
});

test('WebVTT becomes plain spoken text', () => {
  const vtt = [
    'WEBVTT', '', 'NOTE generated by Stream', '',
    '1', '00:00:00.000 --> 00:00:02.000', '<v Mara>Where did this <b>box</b> come from?</v>', '',
    '2', '00:00:02.000 --> 00:00:04.000 align:start', 'Where did this <b>box</b> come from?', '',
    '00:00:04.000 --> 00:00:06.000', 'Fish &amp; chips,', 'again.', '',
  ].join('\r\n');
  assert.equal(vttToText(vtt), 'Where did this box come from? Fish & chips, again.');
  assert.equal(vttToText(vtt, 10), 'Where did ');
  assert.equal(vttToText('WEBVTT\n'), '');
});
