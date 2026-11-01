// The one supabase-js client. Never created in demo mode: there `supabase` is null and getSupabase()
// throws, so a feature that forgot the demo branch fails loudly instead of reaching for the network.
//
// Native: the session is encrypted at rest (sessionStorage.ts) and token refresh runs only while the app is
// in the foreground (Supabase's AppState pattern). Web: default storage, and OAuth redirects come back with
// a PKCE code that detectSessionInUrl exchanges on load.

import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { config } from './env';
import { nativeSessionStorage } from './sessionStorage';

const isWeb = Platform.OS === 'web';

function create(): SupabaseClient | null {
  if (config.demo || !config.supabaseUrl || !config.supabaseKey) return null;
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      ...(nativeSessionStorage ? { storage: nativeSessionStorage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: isWeb,
      // PKCE needs WebCrypto, which the browser has and Hermes doesn't; native sign-in never uses a redirect.
      flowType: isWeb ? 'pkce' : 'implicit',
      ...(isWeb ? {} : { lock: processLock }),
    },
  });
}

export const supabase: SupabaseClient | null = create();

if (supabase && !isWeb) {
  // Refresh tokens only while the app is in the foreground; on return, refresh at once if needed.
  const client = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void client.auth.startAutoRefresh();
    else void client.auth.stopAutoRefresh();
  });
}

export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not available in demo mode: return demo data instead (see src/lib/data.ts).');
  return supabase;
}
