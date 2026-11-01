// The Cloudflare Turnstile site key for the redeem screen (public by design). Expo inlines EXPO_PUBLIC_*
// values only for a direct `process.env.NAME` read, so no destructuring. Without a valid key the screen says
// redeeming isn't available.

import { parseSiteKey } from './redeemLogic';

export const TURNSTILE_SITE_KEY: string | null = parseSiteKey(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY);
