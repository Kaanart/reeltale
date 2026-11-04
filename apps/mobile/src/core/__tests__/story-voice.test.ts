import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../api.ts';
import { encodeWav, VOICE_MAX_BYTES } from '../wav.ts';
import { AI_CONSENT_VERSION } from '../../features/story/logic.ts';
import {
  createTranscribeClient, hasVoiceConsent, matchVoiceChoice, parseTranscript, recorderErrorFromName, recorderErrorKey,
  sameWord, speechTokens, TRANSCRIBE_PATH, voiceErrorView, type VoiceOption,
} from '../../features/story/voiceLogic.ts';

// "Say your choice" (src/features/story/voiceLogic.ts): consent, the transcript-to-choice matcher, error
// wording and the Worker call.

// The demo story's first scene (src/demo/fixtures.ts) and one with an ordinal inside a label.
const ROOT: VoiceOption[] = [
  { id: 'a', label: 'Open the bottle', hint: 'Read what it says' },
  { id: 'b', label: 'Follow the stranger', hint: 'Out onto the sand' },
  { id: 'c', label: 'Run back to the lighthouse', hint: 'Light the lamp, just in case' },
];
const LETTER: VoiceOption[] = [
  { id: 'a', label: 'Write back', hint: 'Answer your own letter' },
  { id: 'b', label: 'Climb the tower', hint: 'Find out who lit the lamp' },
  { id: 'c', label: 'Light the first lamp', hint: 'Before the tide turns' },
];

const pick = (transcript: string, options = ROOT) => {
  const m = matchVoiceChoice(transcript, options);
  return m.kind === 'choice' ? m.id : `unsure:${m.reason}`;
};

test('voice consent: Meta named, this policy version or later, not withdrawn', () => {
  const row = { purpose: 'voice' as const, providers: ['meta'], version: AI_CONSENT_VERSION, withdrawn_at: null };
  assert.equal(hasVoiceConsent(row), true);
  assert.equal(hasVoiceConsent({ ...row, version: '2099-12-31' }), true);
  assert.equal(hasVoiceConsent({ ...row, providers: ['google'] }), false);
  assert.equal(hasVoiceConsent({ ...row, withdrawn_at: '2026-11-01T10:00:00Z' }), false);
  assert.equal(hasVoiceConsent({ ...row, version: '2026-01-01' }), false);
  assert.equal(hasVoiceConsent({ ...row, version: 'v1' }), false);
  assert.equal(hasVoiceConsent({ ...row, purpose: 'story' }), false);
  assert.equal(hasVoiceConsent(null), false);
});

test('speech is normalised: case, accents, apostrophes, punctuation', () => {
  assert.deepEqual(speechTokens('  I’ll take “B”, please!  '), ['ill', 'take', 'b', 'please']);
  assert.deepEqual(speechTokens('Café — NUMBER 2.'), ['cafe', 'number', '2']);
  assert.deepEqual(speechTokens(''), []);
});

test('letters, numbers and ordinals on their own choose', () => {
  const cases: [string, string][] = [
    ['A', 'a'], ['B.', 'b'], ['c', 'c'], ['Bee', 'b'], ['See.', 'c'], ['Two', 'b'], ['3', 'c'], ['One.', 'a'], ['To.', 'b'],
    ['The second one.', 'b'], ['the first one please', 'a'], ['Third.', 'c'], ['The last one', 'c'],
    ['I’ll take the second one, please.', 'b'], ['I think I’d go with the third', 'c'], ['Um, the 2nd one', 'b'],
  ];
  for (const [said, id] of cases) assert.equal(pick(said), id, said);
});

test('a marker names the choice anywhere: option, choice, number, letter', () => {
  const cases: [string, string][] = [
    ['Option B', 'b'], ['choice two', 'b'], ['number three please', 'c'], ['letter a', 'a'], ['I want option see', 'c'],
    ['Let’s do choice to', 'b'], ['my answer is c', 'c'],
  ];
  for (const [said, id] of cases) assert.equal(pick(said), id, said);
  assert.equal(pick('option a or option b'), 'unsure:ambiguous');
});

test('words from a choice choose it when they clearly point to one', () => {
  const cases: [string, string][] = [
    ['Follow the stranger', 'b'], ['the stranger', 'b'], ['open it, open the bottle', 'a'], ['run back', 'c'],
    ['Go back to the light house', 'c'], ['lighthouse', 'c'], ['read what it says', 'a'], ['following him onto the sand', 'b'],
  ];
  for (const [said, id] of cases) assert.equal(pick(said), id, said);
  assert.equal(pick('Climb the tower', LETTER), 'b');
  assert.equal(pick('climbing up the towers', LETTER), 'b', 'word endings');
  assert.equal(pick('write back', LETTER), 'a');
});

test('an ordinal inside a label belongs to that label', () => {
  assert.equal(pick('light the first lamp', LETTER), 'c');
  assert.equal(pick('the first one', LETTER), 'a');
});

test('when it is not clear, nothing is chosen', () => {
  assert.equal(pick(''), 'unsure:empty');
  assert.equal(pick('   ...  '), 'unsure:empty');
  assert.equal(pick('Hmm, I don’t know'), 'unsure:negated');
  assert.equal(pick('not the first one'), 'unsure:negated');
  assert.equal(pick('pizza'), 'unsure:no_match');
  assert.equal(pick('that one'), 'unsure:no_match', '"that one" points at nothing');
  assert.equal(pick('the one'), 'unsure:no_match');
  assert.equal(pick('follow the stranger back to the lighthouse'), 'unsure:ambiguous', 'two choices, neither clearly ahead');
  assert.equal(pick('the first one, follow the stranger'), 'unsure:conflict');
  assert.equal(pick('option a, follow the stranger'), 'unsure:conflict');
  assert.equal(pick('the first and the second'), 'unsure:ambiguous');
  assert.equal(pick('B', []), 'unsure:empty');
});

test('only choices that exist are chosen', () => {
  const two = ROOT.slice(0, 2);
  assert.equal(pick('C', two), 'unsure:no_match');
  assert.equal(pick('the last one', two), 'b');
  assert.equal(pick('three', two), 'unsure:no_match');
});

test('sameWord: endings and small slips, not different words', () => {
  assert.equal(sameWord('stairs', 'stair'), true);
  assert.equal(sameWord('running', 'run'), true);
  assert.equal(sameWord('lighthose', 'lighthouse'), true);
  assert.equal(sameWord('stranger', 'strangers'), true);
  assert.equal(sameWord('light', 'night'), false, 'short words must match exactly or by their ending');
  assert.equal(sameWord('bat', 'cat'), false);
  assert.equal(sameWord('run', 'ruin'), false);
  assert.equal(sameWord('lantern', 'lanterm'), true, 'one slip in a longer word');
  assert.equal(sameWord('sea', 'sand'), false);
});

test('recording errors map to their own messages', () => {
  assert.equal(recorderErrorFromName('NotAllowedError'), 'permission_denied');
  assert.equal(recorderErrorFromName('SecurityError'), 'permission_denied');
  assert.equal(recorderErrorFromName('NotFoundError'), 'no_microphone');
  assert.equal(recorderErrorFromName('NotReadableError'), 'busy');
  assert.equal(recorderErrorFromName('TypeError'), 'not_supported');
  assert.equal(recorderErrorFromName(undefined), 'failed');
  assert.equal(recorderErrorKey('permission_denied'), 'story:voice.errors.permission');
  assert.equal(recorderErrorKey('failed'), 'story:voice.errors.failed');
});

test('Worker errors: consent opens the consent step, bad audio and outages have their own words', () => {
  assert.deepEqual(voiceErrorView('voice_consent_required'), { key: null, consent: true });
  for (const code of ['audio_too_large', 'audio_too_long', 'bad_audio', 'unsupported_media_type', 'audio_unreadable']) {
    assert.deepEqual(voiceErrorView(code), { key: 'story:voice.errors.unreadable', consent: false }, code);
  }
  for (const code of ['transcribe_unavailable', 'network_error', 'timeout', 'internal_error']) {
    assert.deepEqual(voiceErrorView(code), { key: 'story:voice.errors.unavailable', consent: false }, code);
  }
  assert.deepEqual(voiceErrorView('rate_limited'), { key: null, consent: false }, 'errors.ts has the words');
});

test('the transcript answer must be { text } and not too long', () => {
  assert.deepEqual(parseTranscript({ text: '  the second one ' }), { text: 'the second one' });
  assert.deepEqual(parseTranscript({ text: '' }), { text: '' });
  assert.equal(parseTranscript({ text: 3 }), null);
  assert.equal(parseTranscript({ text: 'x'.repeat(1001) }), null);
  assert.equal(parseTranscript(null), null);
});

// ---- The Worker call ------------------------------------------------------------------------------------------

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig';
const WAV = encodeWav(new Int16Array(16_000));

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  }) as typeof fetch;
  return { f, calls };
}

test('transcribe POSTs the WAV with the Bearer token, no cookies, no redirects', async () => {
  const { f, calls } = fakeFetch(() => Response.json({ text: 'Option B' }));
  const client = createTranscribeClient({ baseUrl: 'https://reeltale.net/', getAccessToken: () => TOKEN, fetchImpl: f });
  assert.deepEqual(await client.transcribe(WAV), { text: 'Option B' });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0]!;
  assert.equal(url, `https://reeltale.net${TRANSCRIBE_PATH}`);
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'audio/wav', Accept: 'application/json' });
  assert.equal(init.body, WAV);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
});

test('transcribe turns failures into ApiErrors with safe codes', async () => {
  const run = async (respond: () => Response | Promise<Response>, token: string | null = TOKEN) => {
    const { f } = fakeFetch(respond);
    const client = createTranscribeClient({ baseUrl: 'https://reeltale.net', getAccessToken: () => token, fetchImpl: f });
    try {
      await client.transcribe(WAV);
    } catch (err) {
      assert.ok(err instanceof ApiError);
      return `${err.status}:${err.code}`;
    }
    return 'ok';
  };
  assert.equal(await run(() => Response.json({ error: 'voice_consent_required' }, { status: 403 })), '403:voice_consent_required');
  assert.equal(await run(() => Response.json({ error: 'Bad <b>thing</b>' }, { status: 400 })), '400:unknown_error');
  assert.equal(await run(() => new Response('nope', { status: 502 })), '502:server_error');
  assert.equal(await run(() => new Response('', { status: 429 })), '429:rate_limited');
  assert.equal(await run(() => Response.json({ words: 'x' })), '200:invalid_response');
  assert.equal(await run(() => { throw new TypeError('offline'); }), '0:network_error');
  assert.equal(await run(() => Response.json({ text: 'x' }), null), '401:missing_token');
  assert.equal(await run(() => Response.json({ text: 'x' }), 'bad token'), '401:invalid_token');
});

test('transcribe refuses an oversized file, a cancelled call and a plain-http origin before sending', async () => {
  const { f, calls } = fakeFetch(() => Response.json({ text: '' }));
  const client = createTranscribeClient({ baseUrl: 'https://reeltale.net', getAccessToken: () => TOKEN, fetchImpl: f });
  const big = new Uint8Array(new ArrayBuffer(VOICE_MAX_BYTES + 1));
  await assert.rejects(client.transcribe(big), (e: unknown) => e instanceof ApiError && e.code === 'audio_too_large');
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(client.transcribe(WAV, { signal: ac.signal }), (e: unknown) => e instanceof ApiError && e.code === 'aborted');
  assert.equal(calls.length, 0);
  assert.throws(() => createTranscribeClient({ baseUrl: 'http://reeltale.net', getAccessToken: () => TOKEN }));
  assert.doesNotThrow(() => createTranscribeClient({ baseUrl: 'http://localhost:8787', getAccessToken: () => TOKEN }));
});

test('transcribe times out', async () => {
  const { f } = fakeFetch((_url, init) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const client = createTranscribeClient({ baseUrl: 'https://reeltale.net', getAccessToken: () => TOKEN, fetchImpl: f, timeoutMs: 20 });
  await assert.rejects(client.transcribe(WAV), (e: unknown) => e instanceof ApiError && e.code === 'timeout');
});
