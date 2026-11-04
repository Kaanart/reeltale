// "Say your choice": the rules of the voice step, as pure functions (no React, no DOM), tested in
// src/core/__tests__/story-voice.test.ts.
//
//   consent    has the reader allowed voice input for Meta (public.ai_consents, purpose 'voice')?
//   matching   which of the three choices a transcript means: "B", "the second one", "option two", or words
//              from a choice's label ("follow the stranger"); when it isn't clear, nothing is chosen and the
//              reader is asked again (a new scene costs coins, so a guess is never good enough)
//   errors     what to say when the recording or the transcription didn't work
//   client     POST /api/ai/transcribe with the WAV (src/core/wav.ts), answering { text }

import { ApiError } from '../../core/api.ts';
import { VOICE_MAX_BYTES, VOICE_MAX_MS } from '../../core/wav.ts';
import { AI_CONSENT_VERSION, choiceTakeable, type ChoiceView } from './logic.ts';
import type { AiConsentRow } from './types.ts';

// ---- Consent --------------------------------------------------------------------------------------------

/** Who hears the recording: Meta's Muse Voice Transcribe, through the Worker. The Settings switch names the same. */
export const VOICE_PROVIDERS = ['meta'] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True when voice input is allowed for Meta, for this policy version or a later one, and not withdrawn. */
export function hasVoiceConsent(
  row: Pick<AiConsentRow, 'purpose' | 'providers' | 'version' | 'withdrawn_at'> | null | undefined,
  version: string = AI_CONSENT_VERSION,
): boolean {
  if (!row || row.purpose !== 'voice' || row.withdrawn_at !== null) return false;
  if (!VOICE_PROVIDERS.every((p) => row.providers.includes(p))) return false;
  return ISO_DAY.test(row.version) && row.version >= version;
}

// ---- Matching a transcript to a choice ----------------------------------------------------------------------

export interface VoiceOption {
  id: string;
  label: string;
  hint: string;
}

export type VoiceMatch =
  | { kind: 'choice'; index: number; id: string; via: 'answer' | 'marker' | 'ordinal' | 'label' }
  | { kind: 'unsure'; reason: 'empty' | 'no_match' | 'ambiguous' | 'conflict' | 'negated' };

/** Lower case, no accents, no apostrophes ("I'll" is "ill"), words and numbers only. */
export function speechTokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((t) => t !== '');
}

// Positions, by index into the choices. 'last' is the last choice, whatever their number.
const ORDINALS: Record<string, number> = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, last: -1 };
const NUMBERS: Record<string, number> = { one: 0, '1': 0, two: 1, '2': 1, three: 2, '3': 2 };
const LETTERS: Record<string, number> = { a: 0, b: 1, c: 2 };
// Words a recogniser writes for a spoken letter or number. They count only on their own or after a marker
// ("option see"), never inside a sentence, where they are ordinary words.
const SOUND_ALIKES: Record<string, number> = { ay: 0, eh: 0, won: 0, be: 1, bee: 1, to: 1, too: 1, see: 2, sea: 2, cee: 2, si: 2 };
const MARKERS = new Set(['option', 'choice', 'number', 'letter', 'answer', 'path']);
// Words that carry no meaning in a short answer ("I'll take the second one, please").
const LIGHT = new Set([
  'a', 'an', 'the', 'one', 'ones', 'please', 'um', 'uh', 'er', 'erm', 'hmm', 'ok', 'okay', 'so', 'well', 'i', 'ill', 'id',
  'im', 'ive', 'lets', 'let', 'me', 'my', 'we', 'go', 'going', 'with', 'take', 'choose', 'pick', 'select', 'want', 'wanna',
  'think', 'say', 'its', 'it', 'is', 'that', 'this', 'just', 'yes', 'yeah', 'for', 'will', 'do', 'option', 'choice',
  'number', 'letter', 'answer', 'path',
]);
// Common words that say nothing about which choice is meant.
const STOP = new Set([
  ...LIGHT, 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'by', 'from', 'into', 'onto', 'as', 'than', 'then', 'there',
  'here', 'these', 'those', 'them', 'they', 'their', 'he', 'she', 'him', 'her', 'his', 'hers', 'us', 'our', 'you', 'your',
  'are', 'was', 'were', 'be', 'been', 'am', 'does', 'did', 'would', 'should', 'could', 'can', 'maybe', 'like', 'gonna',
  'what', 'who', 'whats', 'all', 'some', 'any', 'very', 'really', 'now', 'again', 'next', 'up',
]);
const NEGATIONS = new Set(['not', 'dont', 'never', 'nope', 'except']);
// "that one", "the one": a pointer, not the number one.
const POINTERS = new Set(['the', 'that', 'this', 'which']);

function answerIndex(token: string, count: number, alone: boolean): number | null {
  const at = (i: number) => (i === -1 ? count - 1 : i);
  if (token in ORDINALS) return at(ORDINALS[token]!);
  if (token in NUMBERS) return NUMBERS[token]!;
  if (token in LETTERS) return LETTERS[token]!;
  if (alone && token in SOUND_ALIKES) return SOUND_ALIKES[token]!;
  return null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Same word, allowing for endings ("stairs"/"stair", "running"/"run") and a recogniser's small slips ("lighthose"). */
export function sameWord(spoken: string, written: string): boolean {
  if (spoken === written) return true;
  const [short, long] = spoken.length <= written.length ? [spoken, written] : [written, spoken];
  if (short.length >= 3 && long.startsWith(short) && long.length - short.length <= 4) return true;
  if (short.length >= 6 && levenshtein(short, long) <= 1) return true;
  return short.length >= 9 && levenshtein(short, long) <= 2;
}

function contentTokens(text: string): string[] {
  const all = speechTokens(text).filter((t) => !(t in NUMBERS));
  const content = all.filter((t) => !STOP.has(t) && t.length > 1);
  // A label made only of common words ("Go up") still needs something to match.
  return [...new Set(content.length > 0 ? content : all)];
}

interface LabelScore {
  index: number;
  /** Matched words that no other choice has: what tells the choices apart. */
  unique: number;
  score: number;
}

function labelScores(tokens: readonly string[], options: readonly VoiceOption[]): LabelScore[] {
  // The spoken words, plus each pair run together ("light house" can mean "lighthouse").
  const spoken = tokens.filter((t) => !STOP.has(t));
  const heard = [...spoken, ...tokens.slice(1).map((t, i) => `${tokens[i]}${t}`)];
  const said = (word: string) => heard.some((h) => sameWord(h, word));
  const words = options.map((o) => {
    const label = contentTokens(o.label);
    const hint = contentTokens(o.hint).filter((h) => !label.includes(h));
    return { label, hint };
  });
  return options.map((_, index) => {
    const { label, hint } = words[index]!;
    const shared = (word: string) => words.some((w, j) => j !== index && [...w.label, ...w.hint].some((x) => sameWord(x, word)));
    const hitLabel = label.filter(said);
    const hitHint = hint.filter(said);
    const unique = [...hitLabel, ...hitHint].filter((w) => !shared(w)).length;
    const score = (hitLabel.length + hitHint.length / 2) / Math.max(1, label.length);
    return { index, unique, score };
  });
}

/** How far ahead the best label match must be when two choices both have words of their own in the transcript. */
const LABEL_MARGIN = 0.34;

function bestLabel(tokens: readonly string[], options: readonly VoiceOption[]): { index: number } | 'ambiguous' | null {
  const scores = labelScores(tokens, options).filter((s) => s.unique > 0).sort((x, y) => y.score - x.score || y.unique - x.unique);
  const [best, second] = scores;
  if (!best) return null;
  if (!second) return { index: best.index };
  if (best.score - second.score >= LABEL_MARGIN && best.unique > second.unique) return { index: best.index };
  return 'ambiguous';
}

/**
 * Which choice a transcript means, or why it isn't clear. In order:
 *   1. a marker: "option B", "choice two", "number 3"
 *   2. a short answer: "B", "two", "the second one", "the last one, please"
 *   3. words from one choice's label or hint, clearly more than from any other ("climb the tower")
 *   4. an ordinal in a short sentence: "I think I'd go with the second"
 * Anything negated ("not the first one"), conflicting ("the first one, climb the tower" when that is the second
 * choice) or ambiguous is 'unsure': the screen says so and the reader tries again or taps.
 */
export function matchVoiceChoice(transcript: string, options: readonly VoiceOption[]): VoiceMatch {
  const tokens = speechTokens(transcript);
  if (tokens.length === 0 || options.length === 0) return { kind: 'unsure', reason: 'empty' };
  const count = options.length;
  const valid = (i: number | null): i is number => i !== null && i >= 0 && i < count;
  const choice = (index: number, via: Extract<VoiceMatch, { kind: 'choice' }>['via']): VoiceMatch => ({
    kind: 'choice', index, id: options[index]!.id, via,
  });
  if (tokens.some((t) => NEGATIONS.has(t))) return { kind: 'unsure', reason: 'negated' };

  const label = bestLabel(tokens, options);
  const labelIndex = label && label !== 'ambiguous' ? label.index : null;

  // 1. "option B"
  const marked = new Set<number>();
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    if (MARKERS.has(t) && next !== undefined) {
      const at = answerIndex(next, count, true);
      if (valid(at)) marked.add(at);
    }
  });
  if (marked.size > 1) return { kind: 'unsure', reason: 'ambiguous' };
  if (marked.size === 1) {
    const [at] = [...marked];
    if (labelIndex !== null && labelIndex !== at) return { kind: 'unsure', reason: 'conflict' };
    return choice(at!, 'marker');
  }

  // 2. A short answer: once the light words are gone, one answer word is left (or only light words, as in "A" or "one").
  const rest = tokens.filter((t) => !LIGHT.has(t));
  if (rest.length === 1) {
    const at = answerIndex(rest[0]!, count, true);
    if (valid(at)) return choice(at, 'answer');
  } else if (rest.length === 0) {
    const answers = tokens
      .filter((t, i) => !(t === 'one' && i > 0 && POINTERS.has(tokens[i - 1]!)))
      .map((t) => answerIndex(t, count, tokens.length === 1));
    const at = new Set(answers.filter(valid));
    if (at.size === 1) return choice([...at][0]!, 'answer');
    if (at.size > 1) return { kind: 'unsure', reason: 'ambiguous' };
  }

  // 3 and 4. Words from a label, checked against any ordinal in the sentence that isn't part of that label
  // ("Light the first lamp" may well be the third choice).
  const ownWords = labelIndex === null ? [] : contentTokens(`${options[labelIndex]!.label} ${options[labelIndex]!.hint}`);
  const ordinals = new Set(
    tokens.filter((t) => t in ORDINALS && !ownWords.includes(t)).map((t) => answerIndex(t, count, false)).filter(valid),
  );
  if (labelIndex !== null) {
    if (ordinals.size > 0 && !(ordinals.size === 1 && ordinals.has(labelIndex))) return { kind: 'unsure', reason: 'conflict' };
    return choice(labelIndex, 'label');
  }
  if (label === 'ambiguous') return { kind: 'unsure', reason: 'ambiguous' };
  if (ordinals.size === 1 && rest.length <= 4) return choice([...ordinals][0]!, 'ordinal');
  return { kind: 'unsure', reason: ordinals.size > 1 ? 'ambiguous' : 'no_match' };
}

// ---- From a match to what the screen does ------------------------------------------------------------------------

export type VoiceOutcome<C> =
  /** Take this choice, exactly as a tap would. */
  | { kind: 'take'; index: number; choice: C }
  /** The words named a choice that can't be taken now: a path that can't be drawn ('blocked'), or a new scene
   *  while new scenes can't be asked for ('closed': no AI consent yet, the story has ended, the price not loaded). */
  | { kind: 'unavailable'; index: number; choice: C; reason: 'blocked' | 'closed' }
  /** Nothing clear: say what was heard and ask again. */
  | { kind: 'unsure' };

/**
 * What a spoken answer does with the choices on screen. The same rule as a tap and the 1 2 3 keys
 * (logic.ts choiceTakeable): a blocked path never, a new scene only while new scenes can be asked for.
 */
export function voiceOutcome<C extends Pick<ChoiceView, 'id' | 'state'>>(
  match: VoiceMatch,
  choices: readonly C[],
  newDisabled: boolean,
): VoiceOutcome<C> {
  if (match.kind !== 'choice') return { kind: 'unsure' };
  const choice = choices[match.index];
  if (!choice || choice.id !== match.id) return { kind: 'unsure' };
  if (choiceTakeable(choice, newDisabled)) return { kind: 'take', index: match.index, choice };
  return { kind: 'unavailable', index: match.index, choice, reason: choice.state === 'blocked' ? 'blocked' : 'closed' };
}

/** Whole seconds left of a recording that started `elapsedMs` ago (shown while listening). */
export function secondsLeft(elapsedMs: number, maxMs: number = VOICE_MAX_MS): number {
  if (!(elapsedMs > 0)) return Math.ceil(maxMs / 1000);
  return Math.max(0, Math.ceil((maxMs - elapsedMs) / 1000));
}

// ---- What to say ----------------------------------------------------------------------------------------------

/** Why recording didn't start or stopped (features/story/voice/webRecorder.ts). */
export type RecorderErrorCode = 'not_supported' | 'permission_denied' | 'no_microphone' | 'busy' | 'failed';

const RECORDER_KEYS: Record<RecorderErrorCode, string> = {
  not_supported: 'story:voice.errors.notSupported',
  permission_denied: 'story:voice.errors.permission',
  no_microphone: 'story:voice.errors.noMicrophone',
  busy: 'story:voice.errors.busy',
  failed: 'story:voice.errors.failed',
};

export function recorderErrorKey(code: RecorderErrorCode): string {
  return RECORDER_KEYS[code] ?? RECORDER_KEYS.failed;
}

/** The getUserMedia / Web Audio error name, as one of ours. */
export function recorderErrorFromName(name: string | undefined): RecorderErrorCode {
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no_microphone';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    case 'TypeError':
      return 'not_supported';
    default:
      return 'failed';
  }
}

export interface VoiceErrorView {
  /** The i18n key to show, or null: show describeError's message instead. */
  key: string | null;
  /** The voice consent is missing (or was withdrawn in Settings): show the consent step. */
  consent: boolean;
}

/** What the voice step says about a failed POST /api/ai/transcribe, by the Worker's error code. */
export function voiceErrorView(code: string): VoiceErrorView {
  switch (code) {
    case 'voice_consent_required':
      return { key: null, consent: true };
    case 'audio_too_large':
    case 'audio_too_long':
    case 'bad_audio':
    case 'unsupported_media_type':
    case 'audio_unreadable':
      return { key: 'story:voice.errors.unreadable', consent: false };
    case 'transcribe_unavailable':
    case 'not_configured':
    case 'service_unavailable':
    case 'server_error':
    case 'internal_error':
    case 'timeout':
    case 'network_error':
      return { key: 'story:voice.errors.unavailable', consent: false };
    default:
      return { key: null, consent: false };
  }
}

/** Every key the functions above can return. For tests. */
export const VOICE_LOGIC_KEYS: readonly string[] = [...Object.values(RECORDER_KEYS), 'story:voice.errors.unreadable', 'story:voice.errors.unavailable'];

// ---- The Worker call --------------------------------------------------------------------------------------------

export const TRANSCRIBE_PATH = '/api/ai/transcribe';
/** Longest transcript the app takes from the Worker (it sends at most 500 characters). */
export const TRANSCRIPT_MAX = 1000;

const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const TOKEN = /^[A-Za-z0-9._-]+$/;
const LOCAL_HTTP_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2|[a-z0-9-]+\.localhost)$/i;

/** `{ text }` from the Worker, or null for anything else. */
export function parseTranscript(body: unknown): { text: string } | null {
  if (!body || typeof body !== 'object') return null;
  const text = (body as { text?: unknown }).text;
  if (typeof text !== 'string' || text.length > TRANSCRIPT_MAX) return null;
  return { text: text.trim() };
}

function originOf(baseUrl: string): string {
  const m = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:\d{1,5})?\/?$/i.exec(baseUrl.trim());
  const scheme = m?.[1]?.toLowerCase();
  const host = m?.[2];
  if (!m || !scheme || !host || (scheme === 'http' && !LOCAL_HTTP_HOSTS.test(host))) {
    throw new TypeError('baseUrl must be an https origin such as https://reeltale.net');
  }
  return `${scheme}://${host}${m[3] ?? ''}`;
}

export interface TranscribeClientOptions {
  /** The site origin (the web build talks to the origin it was loaded from). */
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Give up after this long. Default 25 s (the Worker allows Meta 15 s). */
  timeoutMs?: number;
}

/**
 * POST /api/ai/transcribe with the recording as `audio/wav` and the user's Bearer token. Answers the text, or
 * throws an ApiError with the Worker's code (voice_consent_required, audio_too_long, transcribe_unavailable,
 * rate_limited ...) or a client one (network_error, timeout, aborted, invalid_response, audio_too_large).
 * No cookies, no redirects, like the rest of the API (core/api.ts).
 */
export function createTranscribeClient(opts: TranscribeClientOptions) {
  const base = originOf(opts.baseUrl);
  const timeoutMs = opts.timeoutMs !== undefined && opts.timeoutMs > 0 ? Math.min(opts.timeoutMs, 120_000) : 25_000;

  return {
    async transcribe(wav: Uint8Array<ArrayBuffer>, options?: { signal?: AbortSignal }): Promise<{ text: string }> {
      const signal = options?.signal;
      if (signal?.aborted) throw new ApiError(0, 'aborted');
      // The Worker would refuse it anyway; don't send it.
      if (wav.byteLength > VOICE_MAX_BYTES) throw new ApiError(413, 'audio_too_large');
      let token: string | null;
      try {
        token = await opts.getAccessToken();
      } catch {
        throw new ApiError(401, 'not_authenticated');
      }
      if (!token) throw new ApiError(401, 'missing_token');
      if (!TOKEN.test(token)) throw new ApiError(401, 'invalid_token');
      if (signal?.aborted) throw new ApiError(0, 'aborted');

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      let status: number;
      let text: string;
      try {
        const res = await (opts.fetchImpl ?? globalThis.fetch)(`${base}${TRANSCRIBE_PATH}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav', Accept: 'application/json' },
          body: wav,
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error',
        });
        status = res.status;
        text = await res.text();
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if (timedOut) throw new ApiError(0, 'timeout');
        if (signal?.aborted) throw new ApiError(0, 'aborted');
        throw new ApiError(0, 'network_error');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }

      let body: unknown = null;
      try {
        body = text === '' ? null : JSON.parse(text);
      } catch {
        body = null;
      }
      if (status < 200 || status > 299) {
        const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
        if (typeof error === 'string' && CODE.test(error)) throw new ApiError(status, error);
        throw new ApiError(status, status === 429 ? 'rate_limited' : status >= 500 ? 'server_error' : status === 401 ? 'not_authenticated' : 'unknown_error');
      }
      const out = parseTranscript(body);
      if (!out) throw new ApiError(status, 'invalid_response');
      return out;
    },
  };
}

export type TranscribeClient = ReturnType<typeof createTranscribeClient>;
