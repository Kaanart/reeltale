// What each platform offers for Apple and Google sign-in (providers.ts on iOS/Android, providers.web.ts
// on the web). Both files export `signInProviders` with this shape.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SignInProviders {
  /** Can Sign in with Apple be offered here? */
  appleAvailable(): Promise<boolean>;
  /** Signs in (native), or leaves the page for Apple and comes back signed in (web). */
  signInWithApple(client: SupabaseClient): Promise<void>;
  googleAvailable: boolean;
  signInWithGoogle(client: SupabaseClient): Promise<void>;
}
