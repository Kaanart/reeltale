// Web: Apple and Google through Supabase's OAuth redirect. The page goes to the provider and comes back to
// the site root with a PKCE code, which supabase-js exchanges on load (detectSessionInUrl). The site origin
// must be in Supabase's redirect allow list.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignInProviders } from './providers.types';

async function redirect(client: SupabaseClient, provider: 'apple' | 'google'): Promise<void> {
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

export const signInProviders: SignInProviders = {
  appleAvailable: async () => true,
  signInWithApple: (client) => redirect(client, 'apple'),
  googleAvailable: true,
  signInWithGoogle: (client) => redirect(client, 'google'),
};
