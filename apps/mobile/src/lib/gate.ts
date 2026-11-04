// Where an account stands on the way into the app, and where that sends the user. Pure (tested in
// src/core/__tests__/gate.test.ts); the root layout and src/app/(auth)/_layout.tsx turn it into routes.
//
// Order, as in the blueprint: signed out -> date of birth -> (blocked) -> Terms -> the app.
// The database is the real gate (RLS and the Worker check age_status / the age_ok claim); this only
// decides which screen to show.
//
// The website has a short, explicit list of public pages (PUBLIC_WEB_PATHS) that anyone may open without
// an account. Everything else stays behind the gate, and the native apps have no public pages at all.

/** The Terms version the app asks for (prep/legal/terms-of-service-draft.md, "Last updated"). public.accept_terms wants YYYY-MM-DD. */
export const TERMS_VERSION = '2026-10-22';

export type AgeStatus = 'unknown' | 'adult' | 'blocked';
export type Role = 'user' | 'editor' | 'admin';
/** How the session was started (settings:account.methods). 'demo' is demo mode's quick entry. */
export type SignInMethod = 'email' | 'password' | 'apple' | 'google' | 'demo';

export type Gate =
  | 'loading'   // session or account not known yet
  | 'error'     // signed in, but the account row couldn't be loaded
  | 'signedOut'
  | 'age'       // signed in, no date of birth yet
  | 'blocked'   // under 18 (or reported so): sign-out only
  | 'terms'     // adult, current Terms not accepted
  | 'ready';

/** Gates that are screens in the (auth) group. */
export type AuthGate = 'signedOut' | 'age' | 'blocked' | 'terms';

export type SessionState = 'loading' | 'none' | 'present';

export type AccountState =
  | { status: 'loading' }
  | { status: 'error' }
  /** `row: null` means no profile_private row was found (treated as "no date of birth yet"). */
  | { status: 'ok'; row: { ageStatus: AgeStatus; tosVersion: string | null } | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Has the user accepted these Terms (or newer ones)? Versions are dates, so text order is date order. */
export function termsAccepted(tosVersion: string | null | undefined, current: string = TERMS_VERSION): boolean {
  return typeof tosVersion === 'string' && DAY.test(tosVersion) && tosVersion >= current;
}

export function isAgeStatus(value: unknown): value is AgeStatus {
  return value === 'unknown' || value === 'adult' || value === 'blocked';
}

export function isRole(value: unknown): value is Role {
  return value === 'user' || value === 'editor' || value === 'admin';
}

export function gateFor(session: SessionState, account: AccountState): Gate {
  if (session === 'loading') return 'loading';
  if (session === 'none') return 'signedOut';
  if (account.status !== 'ok') return account.status;
  const row = account.row;
  if (!row || row.ageStatus === 'unknown') return 'age';
  if (row.ageStatus === 'blocked') return 'blocked';
  return termsAccepted(row.tosVersion) ? 'ready' : 'terms';
}

export function isAuthGate(gate: Gate): gate is AuthGate {
  return gate === 'signedOut' || gate === 'age' || gate === 'blocked' || gate === 'terms';
}

/**
 * The gate to lay the screens out for. 'loading' and 'error' are passing states (a refetch, a retry), so
 * the screens of the last real gate stay put underneath the overlay instead of jumping to sign-in.
 */
export function stickyGate(current: Gate, previous: Exclude<Gate, 'loading' | 'error'> | null): Exclude<Gate, 'loading' | 'error'> {
  if (current === 'loading' || current === 'error') return previous ?? 'signedOut';
  return current;
}

/** The (auth) screen of each gate. Paths are the URLs of src/app/(auth)/*.tsx. */
export const GATE_PATHS: Record<AuthGate, string> = {
  signedOut: '/welcome',
  age: '/birthday',
  blocked: '/blocked',
  terms: '/terms',
};

/** Route groups whose layout guards them with Stack.Protected; everything else is checked by redirectFor. */
const GUARDED_GROUPS = new Set(['(auth)', '(tabs)']);
/** Routes anyone may see: the not-found page and Expo Router's sitemap. */
const OPEN_ROUTES = new Set(['+not-found', '_sitemap']);

/**
 * Web pages anyone may open, signed in or not, at exactly these paths (no sub-paths):
 *   '/'        the landing page for visitors (until it exists, the (auth) welcome screen); Home for adults
 *   '/about'   what ReelTale is
 *   '/notice'  reporting illegal content (EU DSA Art. 16: it must work without an account)
 * They show no personal data. Adding a path here makes it public on the web: keep the list short.
 */
export const PUBLIC_WEB_PATHS: readonly string[] = ['/', '/about', '/notice'];

/** A URL path without query, hash or trailing slash ('/' stays '/'). */
export function normalizePath(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] ?? '').trim();
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const trimmed = withSlash.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Is this URL path one of the public web pages? Exact match only ('/about/x' is not public). */
export function isPublicWebPath(pathname: string): boolean {
  return PUBLIC_WEB_PATHS.includes(normalizePath(pathname));
}

/** The URL path of Expo Router segments, without (group) segments: ['(public)', 'about'] -> '/about'. */
export function pathOfSegments(segments: readonly string[]): string {
  const parts = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')) && s !== 'index');
  return `/${parts.join('/')}`;
}

export interface RedirectOptions {
  /** The website: PUBLIC_WEB_PATHS are open to everyone. Native apps leave it false. */
  web?: boolean;
}

/**
 * Feature routes outside the guarded groups (series/[id], watch/…, wallet …) are not listed in the root
 * layout, so Stack.Protected can't hide them. This sends anyone who isn't through the gate to the right
 * (auth) screen instead. Returns null when no redirect is needed. On the web, the public pages
 * (PUBLIC_WEB_PATHS) are left alone for every gate.
 */
export function redirectFor(gate: Gate, segments: readonly string[], options: RedirectOptions = {}): string | null {
  if (gate === 'loading' || gate === 'error' || gate === 'ready') return null;
  const first = segments[0];
  if (first === undefined || GUARDED_GROUPS.has(first) || OPEN_ROUTES.has(first)) return null;
  if (options.web === true && isPublicWebPath(pathOfSegments(segments))) return null;
  return GATE_PATHS[gate];
}
