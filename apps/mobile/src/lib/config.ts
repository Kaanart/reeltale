// Runtime config from the EXPO_PUBLIC_* values, as a pure function so node can test it
// (src/core/__tests__/config.test.ts). src/lib/env.ts feeds it the real values once at start-up.
//
// Demo mode (local fixtures, no network) is on when EXPO_PUBLIC_DEMO is '1', and also whenever
// Supabase isn't configured or its key isn't a publishable one: the app then never talks to anything.
// On the live website a visitor can also choose it ("Explore the demo": ?demo=1, kept for that tab).

import { createApiClient } from '../core/api.ts';

export const DEFAULT_API_URL = 'https://reeltale.net';

export interface RawEnv {
  supabaseUrl?: string | undefined;
  supabaseKey?: string | undefined;
  apiUrl?: string | undefined;
  demo?: string | undefined;
}

export interface PlatformInfo {
  os: string;
  /** window.location.origin on the web; null elsewhere. */
  webOrigin?: string | null;
  /** Web only: the visitor chose "Explore the demo" in this tab (see webDemoChoice). */
  webDemo?: boolean;
}

/** sessionStorage key that keeps a tab in the website's demo. */
export const DEMO_SESSION_KEY = 'reeltale.demo';

/** The website's demo switch: ?demo=1 turns it on for the tab, ?demo=0 off, otherwise what the tab remembered. */
export function webDemoChoice(search: string, remembered: boolean): boolean {
  const q = new URLSearchParams(search).get('demo');
  if (q === '1') return true;
  if (q === '0') return false;
  return remembered;
}

/** Why demo mode is on: built in, chosen by a website visitor, Supabase missing, or a key the app must not hold. */
export type DemoReason = 'flag' | 'session' | 'not_configured' | 'invalid_key';

export interface AppConfig {
  supabaseUrl: string | null;
  supabaseKey: string | null;
  apiUrl: string;
  demo: boolean;
  demoReason: DemoReason | null;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2|[a-z0-9-]+\.localhost)$/i;

/** An https origin (plain http only for a local Supabase), returned without a trailing slash. */
function supabaseOrigin(url: string | undefined): string | null {
  const m = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:\d{1,5})?\/?$/i.exec((url ?? '').trim());
  if (!m || !m[1] || !m[2]) return null;
  if (m[1].toLowerCase() === 'http' && !LOCAL_HOST.test(m[2])) return null;
  return `${m[1].toLowerCase()}://${m[2]}${m[3] ?? ''}`;
}

function base64UrlJson(part: string): unknown {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return null;
  }
}

/**
 * The only Supabase keys a client may hold: a publishable key (`sb_publishable_…`) or a legacy anon JWT.
 * A secret key or a service_role JWT here would hand every visitor full database access, so it is refused.
 */
export function isPublishableKey(key: string | undefined): boolean {
  const k = (key ?? '').trim();
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(k)) return true;
  const parts = k.split('.');
  if (parts.length !== 3 || !parts[1]) return false;
  const payload = base64UrlJson(parts[1]);
  return !!payload && typeof payload === 'object' && (payload as { role?: unknown }).role === 'anon';
}

/** Would the API client accept this base URL? (core/api.ts is the one place that decides.) */
export function isUsableApiUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    createApiClient({ baseUrl: url, getAccessToken: () => null });
    return true;
  } catch {
    return false;
  }
}

/**
 * The API origin: on the web the page's own origin (the Worker serves the app and /api together, and the
 * CSP only allows 'self'); elsewhere EXPO_PUBLIC_API_URL, else https://reeltale.net.
 */
export function resolveApiUrl(raw: RawEnv, platform: PlatformInfo): string {
  if (platform.os === 'web' && isUsableApiUrl(platform.webOrigin)) return platform.webOrigin;
  const explicit = raw.apiUrl?.trim().replace(/\/+$/, '');
  return isUsableApiUrl(explicit) ? explicit : DEFAULT_API_URL;
}

export function resolveConfig(raw: RawEnv, platform: PlatformInfo): AppConfig {
  const apiUrl = resolveApiUrl(raw, platform);
  const url = supabaseOrigin(raw.supabaseUrl);
  const key = raw.supabaseKey?.trim() || null;

  let demoReason: DemoReason | null = null;
  if (raw.demo?.trim() === '1') demoReason = 'flag';
  else if (platform.os === 'web' && platform.webDemo === true) demoReason = 'session';
  else if (!url || !key) demoReason = 'not_configured';
  else if (!isPublishableKey(key)) demoReason = 'invalid_key';

  if (demoReason) return { supabaseUrl: null, supabaseKey: null, apiUrl, demo: true, demoReason };
  return { supabaseUrl: url, supabaseKey: key, apiUrl, demo: false, demoReason: null };
}
