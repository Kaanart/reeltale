// Client for the ReelTale Worker (reeltale.net /api/*): one typed method per route, Bearer auth,
// JSON in and out, every response checked with zod, every failure turned into an ApiError.
//
// Plain TypeScript on top of `fetch`: no React Native, no Expo, no URL class (React Native's is partial).
// Routes are the ones in apps/server/src/app.ts, routes/user.ts and routes/ai.ts. Calls that go straight
// to Supabase (wallet, unlock, date of birth, consents ...) are not here: they are RPCs through supabase-js,
// and their errors go through errors.ts like these do.
//
// What the user may see is decided by errors.ts from ApiError.code. `message` is the code, never text
// from the server.

import { z } from 'zod';
import {
  PlaybackResponseSchema, RedeemResponseSchema, StoryManifestSchema, UploadResponseSchema,
  type PlaybackResponse, type RedeemResponse, type StoryManifest, type UploadResponse,
} from '@reeltale/shared';

// ---- Errors --------------------------------------------------------------------------------------

/**
 * A failed call. `status` is the HTTP status, or 0 when no response came (network_error, timeout,
 * aborted). `code` is the Worker's `error` name, or one the client made: network_error, timeout, aborted,
 * invalid_response, server_error, unknown_error. `detail` is the number the Worker attaches: coins short
 * for insufficient_coins, the current price for price_changed and locked, the debt for refund_debt_outstanding.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: number;

  constructor(status: number, code: string, detail?: number) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** True when the caller cancelled the request (leaving a screen): nothing to show the user. */
export function isAbortError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'aborted';
}

// A code from the server must look like one of our names before we pass it on: no spaces, no HTML.
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

function codeForStatus(status: number): string {
  if (status === 401) return 'not_authenticated';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'unknown_error';
}

/**
 * Build the ApiError for a non-2xx response from its (maybe missing or not JSON) body. Only `error` (if it
 * looks like one of our names) and a whole-number `detail` or `price` are taken; any other text is ignored.
 */
function errorFromResponse(status: number, body: unknown): ApiError {
  const b = body && typeof body === 'object' ? (body as { error?: unknown; detail?: unknown; price?: unknown }) : {};
  if (typeof b.error !== 'string' || !CODE.test(b.error)) return new ApiError(status, codeForStatus(status));
  const n = [b.detail, b.price].find((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0);
  return new ApiError(status, b.error, n);
}

// ---- Request shapes (the same rules as the Worker, so bad input never leaves the device) ---------------

/** Opening line limits of an AI story (routes/ai.ts StartBody). */
export const AI_PREMISE_MIN = 20;
export const AI_PREMISE_MAX = 1000;
export const AI_MAX_TAGS = 10;

const UUID = z.string().uuid();
const StartStoryInput = z.object({
  premise: z.string().trim().min(AI_PREMISE_MIN).max(AI_PREMISE_MAX),
  tags: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(AI_MAX_TAGS).default([]),
  mode: z.literal('comic').default('comic'),
  /**
   * One id per tap (crypto.randomUUID()), reused when retrying that tap: the server then returns the same
   * story instead of charging again. Always send it.
   */
  request_id: UUID.optional(),
});
export type StartStoryInput = z.input<typeof StartStoryInput>;

const ChoiceId = z.enum(['a', 'b', 'c']);
export type ChoiceId = z.infer<typeof ChoiceId>;

// routes/user.ts RedeemBody
const RedeemInput = z.object({
  code: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9-]+$/),
  turnstile_token: z.string().min(10).max(4096),
});

// ---- Response shapes the shared package doesn't define ------------------------------------------------

const HealthSchema = z.object({ ok: z.literal(true), env: z.string() });
export type Health = z.infer<typeof HealthSchema>;

/** The states of public.ai_scenes.status. */
export const SCENE_STATUSES = ['queued', 'generating', 'ready', 'failed', 'blocked'] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

/**
 * Returned by POST /api/ai/stories and /scenes/:id/choose (202). `existing` means a retry found the same job.
 * Choose also sends the scene's `status` (svc.ai_choose): an existing scene may already be ready or blocked, so
 * the app can open it or show why without waiting for the job. An unknown status is dropped, never a failure.
 */
const StartedSchema = z.object({
  story_id: z.string().uuid(),
  scene_id: z.string().uuid(),
  job_id: z.string().uuid(),
  existing: z.boolean().optional(),
  status: z.enum(SCENE_STATUSES).optional().catch(undefined),
});
export type Started = z.infer<typeof StartedSchema>;

// A signed playback or upload URL is only ever followed over https.
const httpsOnly = (u: string) => /^https:\/\//i.test(u);
const SafePlayback = PlaybackResponseSchema.refine((r) => httpsOnly(r.hls));
const SafeUpload = UploadResponseSchema.refine((r) => httpsOnly(r.upload_url));

// ---- Scene assets -------------------------------------------------------------------------------------

/** The image files the Worker serves next to a scene's manifest: panel-1..4 and plate-1..4, always .webp. */
export type SceneAssetFile = `${'panel' | 'plate'}-${1 | 2 | 3 | 4}.webp`;

const ASSET_FILE = /^(panel|plate)-[1-4]\.webp$/;
// A manifest names an asset by its storage key (ai/<story>/<scene>/panel-2.webp, see keys in ai/scene.ts) or by its bare file name.
const ASSET_KEY = /^(?:ai\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/)?((?:panel|plate)-[1-4]\.webp)$/;

export function isSceneAssetFile(file: string): file is SceneAssetFile {
  return ASSET_FILE.test(file);
}

/**
 * The served file for a manifest `image` or `plate` value. Only a storage key of the expected shape (or a
 * bare file name) is accepted. Anything else, a URL included, gives null: the app never follows an address
 * taken from a manifest, it asks its own origin for the file by name.
 */
export function assetFileFromKey(key: string | null | undefined): SceneAssetFile | null {
  const file = key ? ASSET_KEY.exec(key)?.[1] : undefined;
  return file && isSceneAssetFile(file) ? file : null;
}

export interface PanelAssetFiles {
  n: number;
  image: SceneAssetFile | null;
  plate: SceneAssetFile | null;
}

/** Which files to fetch for each panel of a manifest. */
export function panelAssetFiles(manifest: Pick<StoryManifest, 'panels'>): PanelAssetFiles[] {
  return manifest.panels.map((p) => ({ n: p.n, image: assetFileFromKey(p.image), plate: assetFileFromKey(p.plate) }));
}

// ---- Client --------------------------------------------------------------------------------------------

export interface ApiClientOptions {
  /** The site origin, for example `https://reeltale.net`. Plain http is accepted only for local development hosts. */
  baseUrl: string;
  /** The current Supabase access token (refreshed by the caller), or null when signed out. */
  getAccessToken: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Give up on one request after this long. Default 20 s. Anything above setTimeout's limit (about 24.8 days) is capped there. */
  timeoutMs?: number;
}

export interface CallOptions {
  /** Cancel the request, for example when the screen goes away. Gives ApiError code `aborted`. */
  signal?: AbortSignal;
}

/** An image source for expo-image or a fetch: the URL plus the header that authorises it. */
export interface AuthedSource {
  uri: string;
  headers: { Authorization: string };
}

/** The longest delay setTimeout honours. */
const MAX_TIMER_MS = 2_147_483_647;

const LOCAL_HTTP_HOSTS =/^(localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2|[a-z0-9-]+\.localhost)$/i;

/** `https://host[:port]` (or http for a local host) with no path, query or credentials, without a trailing slash. */
function normalizeBaseUrl(baseUrl: string): string {
  const m = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:\d{1,5})?\/?$/i.exec(baseUrl.trim());
  const scheme = m?.[1]?.toLowerCase();
  const host = m?.[2];
  if (!m || !scheme || !host || (scheme === 'http' && !LOCAL_HTTP_HOSTS.test(host))) {
    throw new TypeError('baseUrl must be an https origin such as https://reeltale.net');
  }
  return `${scheme}://${host}${m[3] ?? ''}`;
}

// The Worker accepts tokens of exactly this shape (lib/auth.ts bearerToken); sending anything else is a bug or an injection.
const TOKEN = /^[A-Za-z0-9._-]+$/;

type ResponseKind = 'json' | 'blob';

interface Call<T> {
  method: 'GET' | 'POST';
  path: string;
  /** False only for /api/health, which the Worker answers before it checks auth. */
  auth?: boolean;
  body?: unknown;
  parse?: (data: unknown) => T | null;
  as?: ResponseKind;
  options?: CallOptions;
}

export function createApiClient(opts: ApiClientOptions) {
  const base = normalizeBaseUrl(opts.baseUrl);
  // setTimeout fires at once for delays above 2^31-1 ms (Infinity included), which would time out every request.
  const timeoutMs = opts.timeoutMs !== undefined && opts.timeoutMs > 0 ? Math.min(opts.timeoutMs, MAX_TIMER_MS) : 20_000;

  async function accessToken(): Promise<string> {
    let token: string | null;
    try {
      token = await opts.getAccessToken();
    } catch {
      throw new ApiError(401, 'not_authenticated');
    }
    if (!token) throw new ApiError(401, 'missing_token');
    if (!TOKEN.test(token)) throw new ApiError(401, 'invalid_token');
    return token;
  }

  async function send<T>(call: Call<T>): Promise<T> {
    const signal = call.options?.signal;
    if (signal?.aborted) throw new ApiError(0, 'aborted');

    const headers: Record<string, string> = { Accept: call.as === 'blob' ? 'image/webp' : 'application/json' };
    if (call.auth !== false) headers.Authorization = `Bearer ${await accessToken()}`;
    if (call.body !== undefined) headers['Content-Type'] = 'application/json';
    // The caller may have cancelled while the token was being read: nothing is listening yet, so check again.
    if (signal?.aborted) throw new ApiError(0, 'aborted');

    // One controller for both the timeout and the caller's cancel, so we can tell them apart afterwards.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const doFetch = opts.fetchImpl ?? globalThis.fetch;
    let status: number;
    let ok: boolean;
    let text = '';
    let blob: Blob | null = null;
    try {
      const res = await doFetch(`${base}${call.path}`, {
        method: call.method,
        headers,
        ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
        signal: controller.signal,
        // The API uses Bearer tokens, never cookies, and never redirects: a redirect would be a misrouted request.
        credentials: 'omit',
        redirect: 'error',
      });
      status = res.status;
      ok = res.ok;
      if (ok && call.as === 'blob') {
        const type = res.headers.get('Content-Type') ?? '';
        if (!type.toLowerCase().startsWith('image/webp')) throw new ApiError(status, 'invalid_response');
        blob = await res.blob();
      } else {
        text = await res.text();
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (timedOut) throw new ApiError(0, 'timeout');
      if (signal?.aborted) throw new ApiError(0, 'aborted');
      throw new ApiError(0, 'network_error');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    let json: unknown = null;
    if (blob === null) {
      try {
        json = text === '' ? null : JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!ok) throw errorFromResponse(status, json);
    if (blob !== null) return blob as T;
    const out = call.parse ? call.parse(json) : (json as T);
    if (out === null) throw new ApiError(status, 'invalid_response');
    return out;
  }

  /** A parser for `send`: the zod schema's data, or null when the body doesn't match. */
  const by = <S extends z.ZodType>(schema: S) => (data: unknown): z.output<S> | null => {
    const r = schema.safeParse(data);
    return r.success ? r.data : null;
  };

  const requireUuid = (id: string): string => {
    if (!UUID.safeParse(id).success) throw new ApiError(400, 'bad_request');
    return id;
  };
  const requireBody = <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
    const r = schema.safeParse(input);
    if (!r.success) throw new ApiError(400, 'bad_request');
    return r.data;
  };
  const requireAsset = (file: string): SceneAssetFile => {
    if (!isSceneAssetFile(file)) throw new ApiError(400, 'bad_request');
    return file;
  };

  const assetPath = (sceneId: string, file: SceneAssetFile) => `/api/ai/scenes/${requireUuid(sceneId)}/assets/${file}`;

  // Every method is async, so bad input (an id that isn't a UUID, say) is a rejected promise like any other failure.
  return {
    /** GET /api/health: the Worker is up (no sign-in needed). */
    health: async (options?: CallOptions) =>
      send<Health>({ method: 'GET', path: '/api/health', auth: false, parse: by(HealthSchema), options }),

    /**
     * GET /api/playback/:episodeId: a signed HLS URL, valid about two hours. A locked episode answers 402
     * `locked` with the price in `detail`.
     */
    getPlayback: async (episodeId: string, options?: CallOptions) =>
      send<PlaybackResponse>({
        method: 'GET', path: `/api/playback/${requireUuid(episodeId)}`, parse: by(SafePlayback), options,
      }),

    /** POST /api/uploads: a one-time upload URL for the creator's own draft episode. */
    createUpload: async (episodeId: string, options?: CallOptions) =>
      send<UploadResponse>({
        method: 'POST', path: '/api/uploads', body: { episode_id: requireUuid(episodeId) }, parse: by(SafeUpload), options,
      }),

    /**
     * POST /api/codes/redeem: event access codes. WEB ONLY. The Worker rejects any request whose Origin
     * isn't the site (the browser sets it), and the native apps must not offer code entry (App Store 3.1.1).
     */
    redeemCode: async (input: { code: string; turnstileToken: string }, options?: CallOptions) =>
      send<RedeemResponse>({
        method: 'POST', path: '/api/codes/redeem',
        body: requireBody(RedeemInput, { code: input.code, turnstile_token: input.turnstileToken }),
        parse: by(RedeemResponseSchema), options,
      }),

    /** POST /api/ai/stories: start a story. Costs coins; answers 202 with the first scene's job. */
    startAiStory: async (input: StartStoryInput, options?: CallOptions) =>
      send<Started>({
        method: 'POST', path: '/api/ai/stories', body: requireBody(StartStoryInput, input), parse: by(StartedSchema), options,
      }),

    /** POST /api/ai/scenes/:id/choose: take choice a, b or c. `existing: true` means this choice already has a job. */
    chooseScene: async (sceneId: string, choice: ChoiceId, options?: CallOptions) =>
      send<Started>({
        method: 'POST', path: `/api/ai/scenes/${requireUuid(sceneId)}/choose`, body: requireBody(z.object({ choice: ChoiceId }), { choice }),
        parse: by(StartedSchema), options,
      }),

    /** GET /api/ai/scenes/:id/manifest: the finished scene, checked with StoryManifestSchema and against the scene asked for. */
    getSceneManifest: async (sceneId: string, options?: CallOptions) =>
      send<StoryManifest>({
        method: 'GET', path: `/api/ai/scenes/${requireUuid(sceneId)}/manifest`,
        parse: (data) => {
          const r = StoryManifestSchema.safeParse(data);
          return r.success && r.data.scene_id.toLowerCase() === sceneId.toLowerCase() ? r.data : null;
        },
        options,
      }),

    /** The URL of a panel or plate image. It needs the Authorization header: use sceneAssetSource or fetchSceneAsset. */
    sceneAssetUrl: (sceneId: string, file: string): string => `${base}${assetPath(sceneId, requireAsset(file))}`,

    /** The URL and header for expo-image (`source={{ uri, headers }}`). */
    sceneAssetSource: async (sceneId: string, file: string): Promise<AuthedSource> => ({
      uri: `${base}${assetPath(sceneId, requireAsset(file))}`,
      headers: { Authorization: `Bearer ${await accessToken()}` },
    }),

    /** Fetch an image with the header and return it as a Blob (for the web, which shows it as a blob: URL). */
    fetchSceneAsset: async (sceneId: string, file: string, options?: CallOptions) =>
      send<Blob>({ method: 'GET', path: assetPath(sceneId, requireAsset(file)), as: 'blob', options }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
