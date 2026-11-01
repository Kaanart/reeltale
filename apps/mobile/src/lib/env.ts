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
import { resolveConfig, type AppConfig } from './config';

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
  },
);

export const isDemo = config.demo;

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
