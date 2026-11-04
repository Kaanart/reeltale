// The app's runtime config, read once at start-up. Only public values: the Supabase URL and publishable
// key, the API origin, and the demo switch. Set them in EAS env (builds) or apps/mobile/.env (local).
//
//   EXPO_PUBLIC_SUPABASE_URL   https://<ref>.supabase.co
//   EXPO_PUBLIC_SUPABASE_KEY   the publishable key (sb_publishable_…), never a secret or service_role key
//   EXPO_PUBLIC_API_URL        Worker origin for the native apps (default https://reeltale.net);
//                              the web build always talks to the origin it was loaded from
//   EXPO_PUBLIC_DEMO           '1' = demo mode: local fixtures, no network
//
// Demo mode also switches on by itself when Supabase isn't configured (see config.ts).

import { Platform } from 'react-native';
import { DEMO_SESSION_KEY, resolveConfig, webDemoChoice, type AppConfig } from './config';

/** The website's "Explore the demo" switch for this tab (storage can be blocked: then it's off). */
function webDemo(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const on = webDemoChoice(window.location.search, window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1');
    if (on) window.sessionStorage.setItem(DEMO_SESSION_KEY, '1');
    else window.sessionStorage.removeItem(DEMO_SESSION_KEY);
    return on;
  } catch {
    return false;
  }
}

// Expo inlines EXPO_PUBLIC_* at build time only for direct `process.env.NAME` reads, so no destructuring.
export const config: AppConfig = resolveConfig(
  {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    demo: process.env.EXPO_PUBLIC_DEMO,
  },
  {
    os: Platform.OS,
    webOrigin: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null,
    webDemo: webDemo(),
  },
);

export const isDemo = config.demo;

/** A live website tab in the demo by choice: it can leave again (DemoFrame). */
export const isDemoSession = config.demoReason === 'session';

/** Full page loads, so the config above is read again. Web only. */
export function enterWebDemo() {
  window.location.assign('/?demo=1');
}
export function leaveWebDemo() {
  window.location.assign('/?demo=0');
}

/**
 * Where the public media bucket is served (covers, posters, previews). The database stores keys such as
 * `public/covers/<id>.jpg`; the picture lives at `${MEDIA_ORIGIN}/<key>`. The same origin as the Worker's
 * MEDIA_ORIGIN, which the web CSP allows in img-src.
 */
export const MEDIA_ORIGIN = 'https://media.reeltale.net';

if (__DEV__ && config.demoReason === 'invalid_key') {
  // The value itself is never logged.
  console.warn('EXPO_PUBLIC_SUPABASE_KEY is not a publishable key, so the app runs in demo mode.');
}
