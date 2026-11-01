// The AI story track's rules, as pure functions (no React, no timers, no network), so each can be tested
// with node:test (src/core/__tests__/story-logic.test.ts):
//
//   consent       has the reader allowed AI story creation, for every provider the pipeline uses?
//   opening       premise and tag checks, the same limits as the Worker (core/api.ts)
//   prices        the coin prices from pricing_config, and whether the wallet covers one
//   request ids   one id per tap, reused when that tap is retried, so a retry never charges twice
//   scenes        what the player shows for a scene row and its latest job
//   choices       what each of the three choices costs or leads to, and whether new ones can be asked for
//   stories       how the Create tab lists the reader's stories
//   playback      which text is up at a moment of the scene clock, and where "skip" jumps to

import type { Choice, StoryManifest, Wallet } from '@reeltale/shared';
import { AI_MAX_TAGS, AI_PREMISE_MAX, AI_PREMISE_MIN, type ChoiceId, type Started } from '../../core/api.ts';
import type { ComicTimeline, RevealStep } from '../../core/comic.ts';
import { describeJob, jobFailureKey, type JobView } from '../../core/jobs.ts';
import type { TagRow } from '../../lib/types.ts';
import type { AiConsentRow, AiJobRow, AiSceneRow, AiStoryRow } from './types.ts';

export { AI_MAX_TAGS, AI_PREMISE_MAX, AI_PREMISE_MIN };

// ---- Consent ---------------------------------------------------------------------------------------

/**
 * The version of the AI consent the app asks for: the "Last updated" date of the AI Content Policy
 * (prep/legal/ai-content-policy-draft.md). A newer date here asks everyone again.
 */
export const AI_CONSENT_VERSION = '2026-10-22';
/** Who receives the reader's text: Meta's models write and draw, Google's voice may read the narration. */
export const AI_STORY_PROVIDERS = ['meta', 'google'] as const;
export const AI_POLICY_URL = 'https://eurastudios.com/apps/reeltale/ai-policy/';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when the reader's consent for AI stories is current: not withdrawn, naming every provider the
 * pipeline uses, and given for this version of the policy or a later one.
 */
export function hasStoryConsent(
  row: Pick<AiConsentRow, 'purpose' | 'providers' | 'version' | 'withdrawn_at'> | null | undefined,
  version: string = AI_CONSENT_VERSION,
): boolean {
  if (!row || row.purpose !== 'story' || row.withdrawn_at !== null) return false;
  if (!AI_STORY_PROVIDERS.every((p) => row.providers.includes(p))) return false;
  return ISO_DAY.test(row.version) && row.version >= version;
}

// ---- The opening ------------------------------------------------------------------------------------

export type PremiseCheck =
  | { ok: true; premise: string }
  | { ok: false; problem: 'too_short' | 'too_long'; length: number };

/** The opening as the Worker will see it (trimmed), or why it can't be sent. Lengths are UTF-16 units, as zod counts them. */
export function checkPremise(input: string): PremiseCheck {
  const premise = input.trim();
  if (premise.length < AI_PREMISE_MIN) return { ok: false, problem: 'too_short', length: premise.length };
  if (premise.length > AI_PREMISE_MAX) return { ok: false, problem: 'too_long', length: premise.length };
  return { ok: true, premise };
}

/** A tag slug the Worker accepts. */
export const TAG_SLUG = /^[a-z0-9-]{2,40}$/;

/** Add or remove one tag. Adding past the limit, or a slug the Worker would refuse, changes nothing. */
export function toggleTag(selected: readonly string[], slug: string, max: number = AI_MAX_TAGS): string[] {
  if (selected.includes(slug)) return selected.filter((s) => s !== slug);
  if (selected.length >= max || !TAG_SLUG.test(slug)) return [...selected];
  return [...selected, slug];
}

/** Tags a story may carry: genres and tropes (content warnings are set by editors, not by the opening). */
export function storyTags(tags: readonly TagRow[]): { genres: TagRow[]; tropes: TagRow[] } {
  const usable = tags.filter((t) => TAG_SLUG.test(t.slug)).sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug));
  return { genres: usable.filter((t) => t.kind === 'genre'), tropes: usable.filter((t) => t.kind === 'trope') };
}

/** The tag's name in the reader's language, else English, else the slug. */
export function tagName(tag: Pick<TagRow, 'name_i18n' | 'slug'>, language: string): string {
  const base = language.split('-')[0] ?? language;
  return tag.name_i18n[language] ?? tag.name_i18n[base] ?? tag.name_i18n.en ?? tag.slug;
}

// ---- Prices -----------------------------------------------------------------------------------------

export interface AiPrices {
  /** ai_story_start_coins: the story plan plus the first scene. */
  storyStart: number;
  /** ai_comic_scene_coins: each new scene after the first. */
  comicScene: number;
}

export const DEFAULT_AI_PRICES: AiPrices = { storyStart: 50, comicScene: 30 };

const PRICE_KEYS: Record<string, keyof AiPrices> = {
  ai_story_start_coins: 'storyStart',
  ai_comic_scene_coins: 'comicScene',
};

/** A pricing_config value the way cfg_int reads it: a whole number, or a string of digits. */
function configCoins(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value < 2 ** 31 ? value : null;
  if (typeof value === 'string' && /^\s*\d{1,9}\s*$/.test(value)) return Number(value.trim());
  return null;
}

/** From `select key, value from pricing_config` rows. Missing or unreadable keys keep the SQL defaults. */
export function parseAiPrices(rows: unknown): AiPrices {
  const out: AiPrices = { ...DEFAULT_AI_PRICES };
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { key, value } = row as { key?: unknown; value?: unknown };
    const field = typeof key === 'string' && Object.hasOwn(PRICE_KEYS, key) ? PRICE_KEYS[key] : undefined;
    const coins = field ? configCoins(value) : null;
    if (field && coins !== null) out[field] = coins;
  }
  return out;
}

export type Affordability = 'ok' | 'short' | 'debt' | 'unknown';

/**
 * Can the wallet pay `price` now? 'debt' when a refund left coins owed (the server refuses AI starts
 * until it is paid off), 'unknown' while the wallet hasn't loaded. The server decides in the end.
 */
export function affordability(wallet: Pick<Wallet, 'balance' | 'refund_debt'> | null | undefined, price: number): Affordability {
  if (!wallet) return 'unknown';
  if (wallet.refund_debt > 0) return 'debt';
  return wallet.balance >= price ? 'ok' : 'short';
}

/**
 * Demo mode only: take `coins` from a wallet the way the ledger does, soonest-expiring bonus lots first,
 * then paid coins. A wallet that can't pay comes back unchanged.
 */
export function spendCoins(wallet: Wallet, coins: number): Wallet {
  if (!(coins > 0) || wallet.balance < coins) return wallet;
  let left = coins;
  const expiring = [...wallet.expiring]
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
    .map((lot) => {
      const take = Math.min(lot.coins, left);
      left -= take;
      return { ...lot, coins: lot.coins - take };
    })
    .filter((lot) => lot.coins > 0);
  const bonus = expiring.reduce((sum, lot) => sum + lot.coins, 0);
  const paid = wallet.paid - left;
  return { ...wallet, expiring, bonus, paid, balance: paid + bonus };
}

// ---- One request id per tap ---------------------------------------------------------------------------

/** What makes two taps "the same request": the trimmed opening and the tags, in any order. */
export function startFingerprint(premise: string, tags: readonly string[]): string {
  return JSON.stringify([premise.trim(), [...tags].sort()]);
}

/**
 * Hands out the request_id for a story start. A tap gets a fresh id; tapping again for the same opening
 * after a failure (a retry) reuses it, so if the first request did reach the server, the retry returns that
 * story instead of charging again. A changed opening, or a start that went through, gets a new id.
 */
export class RequestIds {
  private readonly newId: () => string;
  private current: { id: string; fingerprint: string } | null = null;

  constructor(newId: () => string) {
    this.newId = newId;
  }

  idFor(fingerprint: string): string {
    if (this.current?.fingerprint !== fingerprint) this.current = { id: this.newId(), fingerprint };
    return this.current.id;
  }

  /** The start went through: the next tap is a new request. */
  succeeded(): void {
    this.current = null;
  }

  /** The start sent with `id` is over (it went through, or the server already finished with it): the next tap gets a new id. */
  finished(id: string): void {
    if (this.current?.id === id) this.current = null;
  }
}

/**
 * The RequestIds of each signed-in reader for the whole app session, not one visit to story/new. A start whose
 * answer never came (a timeout, or the reader left the screen while it was on its way) is then still the same
 * request when the same opening is sent again from a reopened screen, and the server returns that story
 * instead of charging for a second one.
 */
export class RequestIdsByUser {
  private readonly newId: () => string;
  private readonly byUser = new Map<string, RequestIds>();

  constructor(newId: () => string) {
    this.newId = newId;
  }

  for(userId: string): RequestIds {
    let ids = this.byUser.get(userId);
    if (!ids) {
      ids = new RequestIds(this.newId);
      this.byUser.set(userId, ids);
    }
    return ids;
  }
}

/**
 * True when a failed start's request id is already used up: the server made the story, couldn't launch its job
 * and refunded it (generation_unavailable). Sending that id again would only return the failed story, so the next
 * tap needs a new one. Any other failure never reached the server, or was refused before anything was made, or
 * has an unknown outcome, and keeps the id.
 */
export function startRequestSpent(code: string): boolean {
  return code === 'generation_unavailable';
}

// ---- Scenes -------------------------------------------------------------------------------------------

export type ScenePhase = 'working' | 'ready' | 'failed' | 'blocked';
export type FailureAction = 'tryAnother' | 'retry' | 'edit';

export interface SceneView {
  phase: ScenePhase;
  /** The job's progress, for the progress screen. */
  job: JobView;
  /** 'story_start' while the first scene (with the plan and the cast) is made. */
  kind: 'story_start' | 'scene';
  /** An `ai:failure.*` key (always says the coins were returned) when the scene failed or was blocked. */
  failureKey: string | null;
  /** What the reader can do about a failure, most useful first. */
  actions: FailureAction[];
  /** Keep polling: the job may still change. */
  polling: boolean;
}

type SceneLike = Pick<AiSceneRow, 'status' | 'parent_scene_id'>;
type JobLike = Pick<AiJobRow, 'kind' | 'status' | 'progress' | 'error_code'>;

/** Failure actions: an opening can only be edited; a later scene can be tried again (charged again) unless it was blocked. */
export function failureActions(phase: 'failed' | 'blocked', isRoot: boolean): FailureAction[] {
  if (isRoot) return ['edit'];
  return phase === 'blocked' ? ['tryAnother'] : ['tryAnother', 'retry'];
}

/**
 * The failure actions the player offers now. A retry costs a scene, so it is left out once the story takes no
 * new scenes (svc.ai_choose refuses them after an ending) and while the scene price isn't known.
 */
export function offeredFailureActions(
  actions: readonly FailureAction[],
  storyStatus: AiStoryRow['status'] | null | undefined,
  priceKnown: boolean,
): FailureAction[] {
  return actions.filter((a) => a !== 'retry' || (priceKnown && storyTakesChoices(storyStatus)));
}

/** How often the player asks about a scene that is being made. */
export const SCENE_POLL_MS = 2000;
/** The slower pace after a poll failed, so a network blip doesn't stop the progress screen for good. */
export const SCENE_POLL_RETRY_MS = 10_000;

/**
 * When to ask about a scene again (useSceneState's refetchInterval): every SCENE_POLL_MS while it is being
 * made, more slowly after a failed poll, never once it is final. Before anything loaded, a failure stops it
 * and the screen offers a retry.
 */
export function scenePollMs(loaded: Pick<SceneView, 'polling'> | null, failed: boolean): number | false {
  if (!loaded) return failed ? false : SCENE_POLL_MS;
  if (!loaded.polling) return false;
  return failed ? SCENE_POLL_RETRY_MS : SCENE_POLL_MS;
}

/**
 * A query's error, only while it has nothing to show. A background refetch that fails (refocus, polling)
 * keeps the data it had, and must not replace a scene that is playing with an error screen.
 */
export function errorWithoutData<E>(query: { data: unknown; error: E | null }): E | null {
  return query.data === undefined ? query.error : null;
}

/**
 * What to show for a scene, from its row and its latest job (both owner-only, read together every ~2 s).
 * The scene row is the authority once it says ready, failed or blocked. While it is still queued or
 * generating, a job that already finished decides (the two reads can land either side of the update);
 * a job that succeeded before the row says so is shown as ready, and the manifest route checks access.
 */
export function describeScene(scene: SceneLike, job: JobLike | null): SceneView {
  const kind = job?.kind ?? (scene.parent_scene_id === null ? 'story_start' : 'scene');
  const isRoot = scene.parent_scene_id === null;
  const jobView = describeJob(job ?? { status: 'queued', progress: null, error_code: null }, kind);
  const done = (phase: ScenePhase, failureKey: string | null): SceneView => ({
    phase, job: jobView, kind, failureKey,
    actions: phase === 'failed' || phase === 'blocked' ? failureActions(phase, isRoot) : [],
    polling: false,
  });

  if (scene.status === 'ready') return done('ready', null);
  if (scene.status === 'blocked') return done('blocked', 'ai:failure.blocked');
  if (scene.status === 'failed') {
    // A failed (not blocked) scene: the job says why, but a blocked reason never becomes "blocked" here,
    // because the scene row says the path can be tried again.
    const key = jobFailureKey(job?.error_code);
    return done('failed', key === 'ai:failure.blocked' ? 'ai:failure.failed' : key);
  }
  if (job && jobView.finished) {
    if (jobView.phase === 'ready') return done('ready', null);
    if (jobView.phase === 'blocked') return done('blocked', jobView.failureKey);
    return done('failed', jobView.failureKey);
  }
  return { phase: 'working', job: jobView, kind, failureKey: null, actions: [], polling: true };
}

// ---- Choices ------------------------------------------------------------------------------------------

export type ChoiceState =
  | 'new'       // never taken: costs a scene
  | 'ready'     // taken before and drawn: opens at once, free
  | 'working'   // taken, its scene is being made: opens the progress, free
  | 'failed'    // taken, the scene failed and was refunded: trying again costs a scene
  | 'blocked';  // taken, the scene couldn't be made safely: can't be taken again

export interface ChoiceView {
  id: ChoiceId;
  label: string;
  hint: string;
  state: ChoiceState;
  /** The scene this choice already leads to, if any. */
  sceneId: string | null;
  /** Coins taking it costs now (0 when it opens an existing scene). */
  cost: number;
}

/** The three choices of a scene, joined with the scenes already made from it (public.ai_scenes, children of this scene). */
export function describeChoices(
  choices: readonly Choice[],
  children: readonly Pick<AiSceneRow, 'id' | 'chosen_choice' | 'status'>[],
  scenePrice: number,
): ChoiceView[] {
  return choices.map((c) => {
    const child = children.find((s) => s.chosen_choice === c.id) ?? null;
    let state: ChoiceState = 'new';
    if (child?.status === 'ready') state = 'ready';
    else if (child?.status === 'queued' || child?.status === 'generating') state = 'working';
    else if (child?.status === 'failed') state = 'failed';
    else if (child?.status === 'blocked') state = 'blocked';
    const cost = state === 'new' || state === 'failed' ? scenePrice : 0;
    return { id: c.id, label: c.label, hint: c.hint, state, sceneId: child?.id ?? null, cost };
  });
}

/** After POST /choose: open the scene, or say calmly that this path can't be drawn and stay. */
export function chooseOutcome(started: Pick<Started, 'status'>): 'open' | 'blocked' {
  return started.status === 'blocked' ? 'blocked' : 'open';
}

/**
 * Can new scenes still be asked for? Only while the story is active: once an ending is reached the story
 * is completed and svc.ai_choose refuses every new path (scenes already made still open). Unknown (not
 * loaded yet) counts as open, and the server decides.
 */
export function storyTakesChoices(status: AiStoryRow['status'] | null | undefined): boolean {
  return status == null || status === 'active';
}

// ---- The reader's stories (Create tab) ---------------------------------------------------------------------

/** Longest opening shown as a story's name before the plan has given it a title. */
export const UNTITLED_PREVIEW = 60;

/** The name to list a story under: its title, else the start of its opening (cut at a word), else null. */
export function storyListTitle(story: Pick<AiStoryRow, 'title' | 'premise'>, max: number = UNTITLED_PREVIEW): string | null {
  const title = story.title?.trim();
  if (title) return title;
  const premise = story.premise.trim().replace(/\s+/g, ' ');
  if (premise === '') return null;
  if (premise.length <= max) return premise;
  const cut = premise.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?–—-]+$/u, '')}…`;
}

const STORY_STATUSES = ['planning', 'active', 'completed', 'failed', 'blocked'] as const;

/** The i18n key of a story's status in the list (`story:list.status.*`). */
export function storyStatusKey(status: AiStoryRow['status']): string {
  return `story:list.status.${(STORY_STATUSES as readonly string[]).includes(status) ? status : 'active'}`;
}

// ---- Playback -------------------------------------------------------------------------------------------

export interface VisibleText {
  caption: boolean;
  /** Indexes into the panel's dialogue. */
  lines: number[];
}

/**
 * The manifest as the player paces it. The app doesn't play narration audio yet (the Worker serves only the
 * panel and plate pictures), so the panels follow reading time rather than a track nobody hears.
 */
export function readingPaced<M extends Pick<StoryManifest, 'narration'>>(manifest: M): M {
  if (manifest.narration.audio === null && manifest.narration.duration_ms === null) return manifest;
  return { ...manifest, narration: { ...manifest.narration, audio: null, duration_ms: null } };
}

/** Which of panel `n`'s caption and dialogue lines are up at `positionMs` on the scene clock (revealPlan). */
export function visibleText(steps: readonly RevealStep[], n: number, positionMs: number): VisibleText {
  let caption = false;
  const lines: number[] = [];
  for (const s of steps) {
    if (s.atMs > positionMs) continue;
    if (s.kind === 'caption' && s.n === n) caption = true;
    if (s.kind === 'dialogue' && s.n === n) lines.push(s.line);
  }
  return { caption, lines: lines.sort((a, b) => a - b) };
}

/**
 * The scene a story opens at when none is named (the story list): the newest one that is ready or still being
 * made, so a path that failed or was blocked doesn't greet the reader; the newest of all when there is no other.
 */
export function sceneToOpen(rows: readonly Pick<AiSceneRow, 'id' | 'status' | 'created_at'>[]): string | null {
  const time = (iso: string) => Date.parse(iso) || 0;
  const newest = [...rows].sort((a, b) => time(b.created_at) - time(a.created_at));
  return (newest.find((r) => r.status !== 'failed' && r.status !== 'blocked') ?? newest[0])?.id ?? null;
}

/**
 * The panel pictures with the ones the image view couldn't show marked as failed. On iOS and Android the
 * picture is requested by expo-image itself, so an HTTP error (an expired token, a 404) only shows up in its
 * onError; this is what puts up the "A picture didn't load" note and its retry.
 */
export function withLoadFailures<S extends { failed: boolean }>(sources: readonly S[], failed: readonly number[]): readonly S[] {
  if (failed.length === 0) return sources;
  return sources.map((s, i) => (failed.includes(i) && !s.failed ? { ...s, failed: true } : s));
}

/** Where "tap to skip ahead" jumps: the start of the next panel, or the end of the scene from the last one. */
export function skipTarget(timeline: ComicTimeline, positionMs: number): number {
  const next = timeline.panels.find((p) => p.startMs > positionMs);
  return next ? next.startMs : timeline.totalMs;
}

/** The scene clock: `base` ms played before the current run, which started at `startedAt` (same clock as `now`). */
export function clockPosition(base: number, startedAt: number | null, now: number, totalMs: number): number {
  const run = startedAt === null ? 0 : Math.max(0, now - startedAt);
  return Math.min(totalMs, Math.max(0, base + run));
}

// ---- "How this scene was made" ----------------------------------------------------------------------------

const TASKS = ['plan', 'sheets', 'script', 'panels', 'check', 'focus', 'plate', 'tts', 'vtt'] as const;
const PROVIDERS = ['meta', 'google', 'cloudflare'] as const;

/** The i18n key naming a pipeline step (`story:howMade.tasks.*`). */
export function taskKey(task: string): string {
  return (TASKS as readonly string[]).includes(task) ? `story:howMade.tasks.${task}` : 'story:howMade.tasks.unknown';
}

/** The i18n key of a provider's name, or null for one this build doesn't know (shown as written). */
export function providerKey(provider: string): string | null {
  return (PROVIDERS as readonly string[]).includes(provider) ? `story:howMade.providers.${provider}` : null;
}

/** Every key the functions above can return. For tests. */
export const STORY_LOGIC_KEYS: readonly string[] = [
  ...TASKS.map((t) => `story:howMade.tasks.${t}`), 'story:howMade.tasks.unknown',
  ...PROVIDERS.map((p) => `story:howMade.providers.${p}`),
  ...STORY_STATUSES.map((s) => `story:list.status.${s}`),
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route param that is a single UUID (anything else, an array included, is not). */
export function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

/** The root stack's route name for story/[id] (src/app/story/[id].tsx). */
export const PLAYER_ROUTE = 'story/[id]';

export interface StackStateLike {
  index: number;
  routes: readonly { name: string; params?: object }[];
}

/**
 * The scene of the player screen right under this one in the stack, if that is what is there. "Try another
 * choice" goes back to it when it is the failed scene's parent (keeping its place and its choices), and
 * otherwise opens the parent in place of this screen (a scene opened from a link or from the story list).
 */
export function sceneBelow(state: StackStateLike | null | undefined): string | null {
  if (!state || state.index < 1) return null;
  const below = state.routes[state.index - 1];
  if (!below || below.name !== PLAYER_ROUTE) return null;
  return asUuid((below.params as { scene?: unknown } | undefined)?.scene);
}
