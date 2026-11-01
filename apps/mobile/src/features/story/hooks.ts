// Data for the AI story screens, live or demo (src/lib/data.ts). Screens never call Supabase or the Worker
// themselves: they use these hooks.
//
// Live: owner-only rows straight from Supabase (RLS, granted columns: ./types.ts), the coin prices from
// pricing_config, consent through set_ai_consent, and the Worker for anything that costs coins or reads
// a scene's files (core/api.ts). Demo: ./demoEngine.ts in a demoState cell, with coins taken from the
// demo wallet. The wallet and consent cells are the Me track's ('me.wallet', 'me.consents'; demoState
// cells are shared by name), so the balance and the Settings switch agree with these screens.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import type { StoryManifest, Wallet } from '@reeltale/shared';

import { ApiError, type ChoiceId, type Started } from '../../core/api';
import { describeError } from '../../core/errors';
import { parseWallet } from '../../core/wallet';
import { demoState, demoTags, demoWallet } from '../../demo';
import { api, db, fromSource, rpc, select, userKey } from '../../lib/data';
import { AI_SCENE_COLUMNS, AI_STORY_COLUMNS, TAG_COLUMNS } from '../../lib/types';
import { useUserId } from '../auth';
import {
  demoChildren, demoChoose, demoIsSample, demoLatestSceneId, demoManifestFor, demoSceneState, demoStart,
  demoStoryById, demoStoryList, initialDemoStories, type DemoStoryState,
} from './demoEngine';
import {
  affordability, AI_CONSENT_VERSION, AI_STORY_PROVIDERS, DEFAULT_AI_PRICES, describeScene, hasStoryConsent,
  parseAiPrices, RequestIdsByUser, SCENE_POLL_MS, scenePollMs, sceneToOpen, spendCoins, startRequestSpent,
  type AiPrices, type RequestIds,
} from './logic';
import {
  AI_CONSENT_COLUMNS, AI_JOB_COLUMNS, AI_SCENE_HEAD_COLUMNS, parseConsentRow, parseJobRow, parseRows, parseSceneHead,
  parseSceneRow, parseStoryRow,
  parseTagRow, PRICING_COLUMNS, type AiConsentRow, type AiJobRow, type AiSceneRow, type AiStoryRow, type TagRow,
} from './types';

/** How often the player asks about a scene that is still being made (logic.ts scenePollMs). */
export const POLL_MS = SCENE_POLL_MS;

const demoStories = demoState<DemoStoryState>('story.stories', initialDemoStories);
/** The Me track's consent rows (public.ai_consents without user_id). Starts empty, so the demo shows the consent step once. */
type DemoConsentRow = Omit<AiConsentRow, 'user_id'>;
const demoConsents = demoState<DemoConsentRow[]>('me.consents', () => []);
const demoWalletCell = demoState<Wallet>('me.wallet', () => demoWallet());

const demoHasConsent = () => hasStoryConsent(demoConsents.get().find((r) => r.purpose === 'story'));

type Id = string | null | undefined;

export const storyKeys = {
  all: (u: Id) => userKey(u, 'story'),
  list: (u: Id) => userKey(u, 'story', 'list'),
  story: (u: Id, storyId: Id) => userKey(u, 'story', 'story', storyId ?? null),
  latest: (u: Id, storyId: Id) => userKey(u, 'story', 'latest', storyId ?? null),
  scene: (u: Id, sceneId: Id) => userKey(u, 'story', 'scene', sceneId ?? null),
  children: (u: Id, sceneId: Id) => userKey(u, 'story', 'children', sceneId ?? null),
  manifest: (u: Id, sceneId: Id) => userKey(u, 'story', 'manifest', sceneId ?? null),
  consent: (u: Id) => userKey(u, 'story', 'consent'),
  prices: (u: Id) => userKey(u, 'story', 'prices'),
  tags: (u: Id) => userKey(u, 'story', 'tags'),
};
/** Under the wallet prefix, so invalidating userKey(u, 'wallet') anywhere refreshes it too; own last part, so its shape never clashes. */
const walletKey = (u: Id) => userKey(u, 'wallet', 'story');

const invalid = () => new ApiError(200, 'invalid_response');

function rowsOrThrow<T>(raw: unknown, parse: (row: unknown) => T | null): T[] {
  const rows = parseRows(raw, parse);
  if (rows === null) throw invalid();
  return rows;
}

function oneOrThrow<T>(raw: unknown, parse: (row: unknown) => T | null, missing: string): T {
  if (raw === null) throw new ApiError(404, missing);
  const row = parse(raw);
  if (row === null) throw invalid();
  return row;
}

// ---- Prices, wallet, consent, tags -------------------------------------------------------------------

export function useAiPrices() {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.prices(userId),
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: () => fromSource<AiPrices>({
      demo: () => DEFAULT_AI_PRICES,
      live: async () => parseAiPrices(await select<unknown>(
        db().from('pricing_config').select(PRICING_COLUMNS).in('key', ['ai_story_start_coins', 'ai_comic_scene_coins']),
      )),
    }),
  });
}

export function useCoinWallet() {
  const userId = useUserId();
  return useQuery({
    queryKey: walletKey(userId),
    enabled: !!userId,
    queryFn: () => fromSource<Wallet>({
      demo: () => demoWalletCell.get(),
      live: () => rpc('get_my_wallet', undefined, parseWallet),
    }),
  });
}

/** True when the reader has allowed AI story creation for the current policy version and every provider. */
export function useStoryConsent() {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.consent(userId),
    enabled: !!userId,
    // Settings (the Me track) can withdraw it from another screen: ask again whenever a story screen opens.
    staleTime: 0,
    queryFn: () => fromSource<boolean>({
      demo: demoHasConsent,
      live: async () => {
        // RLS returns the reader's own row only; (user_id, purpose) is the key, so there is at most one.
        const raw = await select<unknown>(
          db().from('ai_consents').select(AI_CONSENT_COLUMNS).eq('purpose', 'story').maybeSingle(),
        );
        if (raw === null) return false;
        const row = parseConsentRow(raw);
        if (!row) throw invalid();
        return hasStoryConsent(row);
      },
    }),
  });
}

export function useGrantStoryConsent() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fromSource<void>({
      demo: () => {
        const row: DemoConsentRow = {
          purpose: 'story', providers: [...AI_STORY_PROVIDERS], version: AI_CONSENT_VERSION,
          accepted_at: new Date().toISOString(), withdrawn_at: null,
        };
        demoConsents.set((rows) => [...rows.filter((r) => r.purpose !== 'story'), row]);
      },
      live: async () => {
        await rpc('set_ai_consent', {
          p_purpose: 'story', p_providers: [...AI_STORY_PROVIDERS], p_version: AI_CONSENT_VERSION, p_granted: true,
        });
      },
    }),
    onSuccess: () => {
      queryClient.setQueryData(storyKeys.consent(userId), true);
      void queryClient.invalidateQueries({ queryKey: storyKeys.consent(userId) });
      // Settings (the Me track) lists the same consents.
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'me', 'consents') });
    },
  });
}

/** Genres and tropes a story can carry (public.tags). */
export function useStoryTags() {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.tags(userId),
    enabled: !!userId,
    staleTime: 60 * 60_000,
    queryFn: () => fromSource<TagRow[]>({
      demo: () => [...demoTags],
      live: async () => rowsOrThrow(
        await select<unknown>(db().from('tags').select(TAG_COLUMNS).in('kind', ['genre', 'trope']).order('sort')),
        parseTagRow,
      ),
    }),
  });
}

// ---- Stories and scenes ----------------------------------------------------------------------------------

/** The reader's AI stories, most recently changed first. */
export function useMyStories() {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.list(userId),
    enabled: !!userId,
    queryFn: () => fromSource<AiStoryRow[]>({
      demo: () => demoStoryList(demoStories.get(), Date.now()),
      live: async () => rowsOrThrow(
        await select<unknown>(db().from('ai_stories').select(AI_STORY_COLUMNS).order('updated_at', { ascending: false }).limit(30)),
        parseStoryRow,
      ),
    }),
  });
}

export interface StoryInfo {
  story: AiStoryRow;
  /** Demo only: a story started in this session, which plays the sample scenes. */
  sample: boolean;
}

export function useStory(storyId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.story(userId, storyId),
    enabled: !!userId && !!storyId,
    queryFn: () => fromSource<StoryInfo>({
      demo: () => {
        const state = demoStories.get();
        return { story: demoStoryById(state, storyId ?? '', Date.now()), sample: demoIsSample(state, storyId ?? '') };
      },
      live: async () => ({
        story: oneOrThrow(
          await select<unknown>(db().from('ai_stories').select(AI_STORY_COLUMNS).eq('id', storyId ?? '').maybeSingle()),
          parseStoryRow, 'not_found',
        ),
        sample: false,
      }),
    }),
  });
}

/** The scene to open when a story is opened without one: the newest that didn't fail (logic.ts sceneToOpen). */
export function useLatestSceneId(storyId: string | null, enabled: boolean) {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.latest(userId, storyId),
    enabled: !!userId && !!storyId && enabled,
    staleTime: 0,
    queryFn: () => fromSource<string | null>({
      demo: () => demoLatestSceneId(demoStories.get(), storyId ?? '', Date.now()),
      live: async () => sceneToOpen(rowsOrThrow(
        await select<unknown>(
          db().from('ai_scenes').select(AI_SCENE_HEAD_COLUMNS).eq('story_id', storyId ?? '')
            .order('created_at', { ascending: false }).limit(50),
        ),
        parseSceneHead,
      )),
    }),
  });
}

export interface SceneState {
  scene: AiSceneRow;
  job: AiJobRow | null;
}

async function loadSceneState(sceneId: string): Promise<SceneState> {
  const [sceneRaw, jobRaw] = await Promise.all([
    select<unknown>(db().from('ai_scenes').select(AI_SCENE_COLUMNS).eq('id', sceneId).maybeSingle()),
    select<unknown>(
      db().from('ai_jobs').select(AI_JOB_COLUMNS).eq('scene_id', sceneId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ),
  ]);
  const scene = oneOrThrow(sceneRaw, parseSceneRow, 'scene_not_found');
  const job = jobRaw === null ? null : parseJobRow(jobRaw);
  if (jobRaw !== null && job === null) throw invalid();
  return { scene, job };
}

/**
 * A scene and its latest job. Asked again every POLL_MS while the scene is being made (ai_jobs is owner-only,
 * and its progress column moves planning, casting, writing, drawing, checking, framing), then no more. A poll
 * that fails while the scene is being made is tried again more slowly instead of stopping the progress.
 */
export function useSceneState(sceneId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.scene(userId, sceneId),
    enabled: !!userId && !!sceneId,
    staleTime: 0,
    queryFn: () => fromSource<SceneState>({
      demo: () => demoSceneState(demoStories.get(), sceneId ?? '', Date.now()),
      live: () => loadSceneState(sceneId ?? ''),
    }),
    refetchInterval: (query) => {
      const data = query.state.data;
      return scenePollMs(data ? describeScene(data.scene, data.job) : null, query.state.status === 'error');
    },
  });
}

/** The scenes already made from a scene's choices. */
export function useChildScenes(sceneId: string | null, enabled: boolean) {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.children(userId, sceneId),
    enabled: !!userId && !!sceneId && enabled,
    staleTime: 0,
    queryFn: () => fromSource<AiSceneRow[]>({
      demo: () => demoChildren(demoStories.get(), sceneId ?? '', Date.now()),
      live: async () => rowsOrThrow(
        await select<unknown>(db().from('ai_scenes').select(AI_SCENE_COLUMNS).eq('parent_scene_id', sceneId ?? '')),
        parseSceneRow,
      ),
    }),
  });
}

/** A finished scene's manifest (never changes once made). */
export function useSceneManifest(sceneId: string | null, enabled: boolean) {
  const userId = useUserId();
  return useQuery({
    queryKey: storyKeys.manifest(userId, sceneId),
    enabled: !!userId && !!sceneId && enabled,
    staleTime: Infinity,
    queryFn: ({ signal }) => fromSource<StoryManifest>({
      demo: () => demoManifestFor(demoStories.get(), sceneId ?? '', Date.now()),
      live: () => api.getSceneManifest(sceneId ?? '', { signal }),
    }),
  });
}

// ---- Things that cost coins --------------------------------------------------------------------------------

/** Demo stand-in for the server's checks before it takes coins. */
function demoCharge(price: number): void {
  if (!demoHasConsent()) throw new ApiError(403, 'ai_consent_required');
  const wallet = demoWalletCell.get();
  const can = affordability(wallet, price);
  if (can === 'debt') throw new ApiError(402, 'refund_debt_outstanding', wallet.refund_debt);
  if (can !== 'ok') throw new ApiError(402, 'insufficient_coins', Math.max(0, price - wallet.balance));
}

export interface StartInput {
  premise: string;
  tags: string[];
  /** One per tap, the same when that tap is retried (logic.ts RequestIds, from useStartRequestIds). */
  requestId: string;
  /** What the screen showed; demo mode charges it. The server charges its own price. */
  price: number;
}

/** Start request ids per reader, kept for the app session (logic.ts RequestIdsByUser), not per visit to story/new. */
const startIds = new RequestIdsByUser(Crypto.randomUUID);

/** The reader's start request ids: the same opening sent again after a failure, even from a reopened screen, reuses its id. */
export function useStartRequestIds(): RequestIds | null {
  const userId = useUserId();
  return userId ? startIds.for(userId) : null;
}

/**
 * POST /api/ai/stories. Never retried on its own: the reader decides, and the same request id makes that safe.
 * The id is let go here rather than in the screen, so it happens even when the reader left before the answer came.
 */
export function useStartStory() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartInput) => fromSource<Started>({
      demo: () => {
        const state = demoStories.get();
        if (!state.stories.some((s) => s.requestId === input.requestId)) demoCharge(input.price);
        const r = demoStart(state, input, Date.now(), Crypto.randomUUID);
        demoStories.set(r.state);
        if (r.charged > 0) demoWalletCell.set((w) => spendCoins(w, r.charged));
        return r.started;
      },
      live: () => api.startAiStory({ premise: input.premise, tags: input.tags, mode: 'comic', request_id: input.requestId }),
    }),
    onSuccess: (_started, input) => {
      if (userId) startIds.for(userId).finished(input.requestId);
    },
    onError: (error, input) => {
      if (userId && startRequestSpent(describeError(error).code)) startIds.for(userId).finished(input.requestId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'wallet') });
      void queryClient.invalidateQueries({ queryKey: storyKeys.list(userId) });
    },
  });
}

export interface ChooseInput {
  sceneId: string;
  choice: ChoiceId;
  /** The scene price the screen showed (demo mode charges it). */
  price: number;
}

/** POST /api/ai/scenes/:id/choose: an existing scene comes back at once (with its status), a new one costs a scene. */
export function useChooseScene() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChooseInput) => fromSource<Started>({
      demo: () => {
        const state = demoStories.get();
        const known = demoChildren(state, input.sceneId, Date.now()).find((s) => s.chosen_choice === input.choice);
        if (!known || known.status === 'failed') demoCharge(input.price);
        const r = demoChoose(state, input, Date.now(), Crypto.randomUUID);
        demoStories.set(r.state);
        if (r.charged > 0) demoWalletCell.set((w) => spendCoins(w, r.charged));
        return r.started;
      },
      live: () => api.chooseScene(input.sceneId, input.choice),
    }),
    onSettled: (_data, error, input) => {
      void queryClient.invalidateQueries({ queryKey: storyKeys.children(userId, input.sceneId) });
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'wallet') });
      void queryClient.invalidateQueries({ queryKey: storyKeys.list(userId) });
      // Consent withdrawn in Settings while this screen was open: ask again, so the consent card comes back.
      if (error && describeError(error).action === 'ai_consent') void queryClient.invalidateQueries({ queryKey: storyKeys.consent(userId) });
    },
  });
}

/** After a scene finishes or fails: the story's status, the coins (a failure returns them) and the parent's choices change. */
export function useRefreshAfterScene() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return (scene: Pick<AiSceneRow, 'story_id' | 'parent_scene_id'>) => {
    void queryClient.invalidateQueries({ queryKey: userKey(userId, 'wallet') });
    void queryClient.invalidateQueries({ queryKey: storyKeys.list(userId) });
    void queryClient.invalidateQueries({ queryKey: storyKeys.story(userId, scene.story_id) });
    if (scene.parent_scene_id) void queryClient.invalidateQueries({ queryKey: storyKeys.children(userId, scene.parent_scene_id) });
  };
}
