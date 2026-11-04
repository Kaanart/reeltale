// The public notice form (EU Digital Services Act, Art. 16) at /notice: what the Worker accepts, the checks
// the form runs before sending, and the call itself. Pure (no React), tested in
// src/core/__tests__/notice.test.ts.
//
// NoticeBodySchema is the Worker's own NoticeBody (apps/server/src/routes/report.ts), constraint for
// constraint; the test reads the server file and fails when the two drift apart. The form only ever sends
// a body this schema accepts, so a typo never leaves the browser. The Worker and the database check again.
//
// Nothing here stores anything: the form keeps its fields in React state and clears them after sending.

import { z } from 'zod';

export const NOTICE_TARGET_TYPES = ['series', 'episode', 'ai_scene', 'profile'] as const;
export type NoticeTargetType = (typeof NOTICE_TARGET_TYPES)[number];

/** The Worker's REPORT_REASONS, in its order. */
export const NOTICE_REASONS = [
  'minor_safety', 'sexual_content', 'violence', 'hate_harassment', 'self_harm', 'spam_scam', 'copyright',
  'impersonation', 'ai_not_labelled', 'illegal_other', 'other',
] as const;
export type NoticeReason = (typeof NOTICE_REASONS)[number];

/** The order the form lists them in: the most urgent first, "something else" last. */
export const NOTICE_REASON_ORDER: readonly NoticeReason[] = [
  'minor_safety', 'sexual_content', 'violence', 'hate_harassment', 'self_harm', 'impersonation', 'copyright',
  'ai_not_labelled', 'spam_scam', 'illegal_other', 'other',
];

export const DETAILS_MIN = 10;
export const DETAILS_MAX = 2000;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const TOKEN_MIN = 10;
export const TOKEN_MAX = 4096;

/** Reports of child sexual abuse may be anonymous (Art. 16(2)(c)); every other notice names its sender. */
export const ANONYMOUS_REASON: NoticeReason = 'minor_safety';

/** The Worker's NoticeBody, field for field. */
export const NoticeBodySchema = z.object({
  target_type: z.enum(NOTICE_TARGET_TYPES),
  target_id: z.string().uuid(),
  reason: z.enum(NOTICE_REASONS),
  details: z.string().trim().min(DETAILS_MIN).max(DETAILS_MAX),
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
  email: z.string().trim().max(EMAIL_MAX).pipe(z.email()).optional(),
  good_faith: z.literal(true),
  turnstile_token: z.string().min(TOKEN_MIN).max(TOKEN_MAX),
})
  .refine((b) => b.reason === ANONYMOUS_REASON || (b.name !== undefined && b.email !== undefined));

export type NoticeBody = z.output<typeof NoticeBodySchema>;

export function isNoticeTargetType(value: unknown): value is NoticeTargetType {
  return typeof value === 'string' && (NOTICE_TARGET_TYPES as readonly string[]).includes(value);
}

export function isNoticeReason(value: unknown): value is NoticeReason {
  return typeof value === 'string' && (NOTICE_REASONS as readonly string[]).includes(value);
}

/**
 * The i18n key of a reason's label. `illegal_other` is stored under `illegal`: a key ending in `_other` reads
 * as the plural form of another string to i18next.
 */
export function reasonLabelKey(reason: NoticeReason): string {
  return `notice:reasons.${reason === 'illegal_other' ? 'illegal' : reason}`;
}

export function targetLabelKey(type: NoticeTargetType): string {
  return `notice:targets.${type}`;
}

// ---- What is being reported ------------------------------------------------------------------------------

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UuidSchema = z.string().uuid();

export interface ParsedTarget {
  /** Lower-case id the Worker accepts, or null. */
  id: string | null;
  /** What the link itself says it points to, or null when it doesn't say. */
  type: NoticeTargetType | null;
  /** A series page link: those carry the series' name (a slug), not the id the Worker needs. */
  seriesSlugOnly: boolean;
}

/** The path and query of a pasted link ('reeltale.net/watch/…', 'https://…', '/watch/…'), or null for plain text. */
function linkParts(input: string): { path: string; query: URLSearchParams } | null {
  const text = input.trim();
  if (text === '' || /\s/.test(text)) return null;
  let candidate: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) candidate = text;
  else if (text.startsWith('/')) candidate = `https://reeltale.invalid${text}`;
  else if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(text)) candidate = `https://${text}`;
  else return null;
  try {
    const url = new URL(candidate);
    return { path: url.pathname, query: url.searchParams };
  } catch {
    return null;
  }
}

/**
 * Reads what the notifier pasted: a link to an episode (/watch/<id>), a series (/series/<name>), the in-app
 * report link (/report?type=…&id=…), or a bare id. Takes the first id it finds.
 */
export function parseTarget(input: string): ParsedTarget {
  const text = input.trim();
  const link = linkParts(text);
  let type: NoticeTargetType | null = null;
  let raw: string | null = null;

  if (link) {
    const segments = link.path.split('/').filter(Boolean);
    const [first, second] = segments;
    if (first === 'watch' && second) type = 'episode';
    else if (first === 'series' && second) type = 'series';
    else if (first === 'report') {
      const t = link.query.get('type');
      if (isNoticeTargetType(t)) type = t;
      raw = link.query.get('id');
    }
    if (first === 'series' && second && !UUID_IN_TEXT.test(second) && raw === null) {
      return { id: null, type: 'series', seriesSlugOnly: true };
    }
  }

  const found = (raw ?? text).match(UUID_IN_TEXT)?.[0]?.toLowerCase() ?? null;
  const id = found !== null && UuidSchema.safeParse(found).success ? found : null;
  return { id, type, seriesSlugOnly: false };
}

// ---- The form ---------------------------------------------------------------------------------------------

export interface NoticeDraft {
  /** null until chosen (the link may fill it in). */
  targetType: NoticeTargetType | null;
  /** A link or an id. */
  target: string;
  reason: NoticeReason | null;
  details: string;
  name: string;
  email: string;
  goodFaith: boolean;
}

export const EMPTY_DRAFT: NoticeDraft = Object.freeze({
  targetType: null,
  target: '',
  reason: null,
  details: '',
  name: '',
  email: '',
  goodFaith: false,
});

export type NoticeField = 'targetType' | 'target' | 'reason' | 'details' | 'name' | 'email' | 'goodFaith';

/** The order the fields appear in (the first one with a problem gets the focus). */
export const NOTICE_FIELDS: readonly NoticeField[] = ['targetType', 'target', 'reason', 'details', 'name', 'email', 'goodFaith'];

/** Each field's problem, as an i18n key of the notice namespace. */
export type NoticeProblems = Partial<Record<NoticeField, string>>;

export type NoticeFields = Omit<NoticeBody, 'turnstile_token'>;

export type NoticeCheck = { ok: true; fields: NoticeFields } | { ok: false; problems: NoticeProblems };

/** May this notice leave out the sender's name and email? */
export function contactOptional(reason: NoticeReason | null): boolean {
  return reason === ANONYMOUS_REASON;
}

/** The type the notice is about: the one chosen, else the one the link names. */
export function effectiveType(draft: Pick<NoticeDraft, 'targetType' | 'target'>): NoticeTargetType | null {
  return draft.targetType ?? parseTarget(draft.target).type;
}

/** The same problems the Worker would find, one per field, before anything is sent. */
export function checkNotice(draft: NoticeDraft): NoticeCheck {
  const problems: NoticeProblems = {};
  const parsed = parseTarget(draft.target);

  const type = draft.targetType ?? parsed.type;
  if (type === null) problems.targetType = 'notice:errors.typeRequired';
  else if (draft.targetType !== null && parsed.type !== null && parsed.type !== draft.targetType) {
    problems.targetType = 'notice:errors.typeMismatch';
  }

  if (parsed.id === null) {
    if (draft.target.trim() === '') problems.target = 'notice:errors.targetRequired';
    else if (parsed.seriesSlugOnly) problems.target = 'notice:errors.seriesLink';
    else problems.target = 'notice:errors.noId';
  }

  if (draft.reason === null) problems.reason = 'notice:errors.reasonRequired';

  const details = draft.details.trim();
  if (details.length < DETAILS_MIN) problems.details = 'notice:errors.detailsShort';
  else if (details.length > DETAILS_MAX) problems.details = 'notice:errors.detailsLong';

  const optional = contactOptional(draft.reason);
  const name = draft.name.trim();
  if (name === '' && !optional) problems.name = 'notice:errors.nameRequired';
  else if (name.length > NAME_MAX) problems.name = 'notice:errors.nameLong';

  const email = draft.email.trim();
  if (email === '' && !optional) problems.email = 'notice:errors.emailRequired';
  else if (email.length > EMAIL_MAX) problems.email = 'notice:errors.emailLong';
  else if (email !== '' && !z.email().safeParse(email).success) problems.email = 'notice:errors.emailInvalid';

  if (!draft.goodFaith) problems.goodFaith = 'notice:errors.goodFaithRequired';

  if (Object.keys(problems).length > 0 || type === null || parsed.id === null || draft.reason === null) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    fields: {
      target_type: type,
      target_id: parsed.id,
      reason: draft.reason,
      details,
      ...(name !== '' ? { name } : {}),
      ...(email !== '' ? { email } : {}),
      good_faith: true,
    },
  };
}

/** The first field with a problem, in form order. */
export function firstProblem(problems: NoticeProblems): NoticeField | null {
  return NOTICE_FIELDS.find((f) => problems[f] !== undefined) ?? null;
}

/** The request body, checked against the Worker's schema once more. Null if it wouldn't be accepted. */
export function noticeBody(fields: NoticeFields, turnstileToken: string): NoticeBody | null {
  const r = NoticeBodySchema.safeParse({ ...fields, turnstile_token: turnstileToken });
  return r.success ? r.data : null;
}

// ---- Sending ------------------------------------------------------------------------------------------------

export class NoticeError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'NoticeError';
    this.status = status;
    this.code = code;
  }
}

export interface SendNoticeOptions {
  /** The site's origin ('https://reeltale.net'); the form posts to <origin>/api/report. */
  origin: string;
  fetchImpl?: typeof fetch;
  /** Give up after this long. Default 20 s. */
  timeoutMs?: number;
}

const ORIGIN = /^(https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d{1,5})?)\/?$/;

/**
 * POST /api/report. Resolves when the Worker answers 2xx (it says 'received' whether or not the content
 * exists, so the form can't be used to probe ids). Anything else rejects with a NoticeError carrying the
 * Worker's error code (or network_error / timeout).
 */
export async function sendNotice(body: NoticeBody, opts: SendNoticeOptions): Promise<void> {
  if (!ORIGIN.test(opts.origin)) throw new NoticeError(0, 'bad_origin');
  const url = `${opts.origin.replace(/\/$/, '')}/api/report`;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      // No cookies, no redirects: the Worker answers this route itself.
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    throw new NoticeError(0, timedOut ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return;
  let code = `http_${res.status}`;
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data?.error === 'string' && /^[a-z_]{1,40}$/.test(data.error)) code = data.error;
  } catch {
    /* not JSON: keep the status code */
  }
  throw new NoticeError(res.status, code);
}

/** What to tell the notifier when sending failed: a key of the notice namespace (some take {{email}}). */
export function noticeErrorKey(err: unknown): string {
  if (!(err instanceof NoticeError)) return 'notice:errors.failed';
  if (err.code === 'turnstile_failed') return 'notice:errors.turnstile';
  if (err.code === 'rate_limited' || err.status === 429) return 'notice:errors.rateLimited';
  if (err.code === 'not_configured' || err.code === 'service_unavailable' || err.status === 503) return 'notice:errors.unavailable';
  if (err.code === 'network_error' || err.code === 'timeout') return 'notice:errors.network';
  if (err.code === 'bad_request' || err.code === 'too_large' || err.status === 400 || err.status === 413) return 'notice:errors.rejected';
  return 'notice:errors.failed';
}
