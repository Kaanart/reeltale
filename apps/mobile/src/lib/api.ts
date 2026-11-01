// The one Worker client (src/core/api.ts) for the whole app. The token is the current Supabase session's;
// when the Worker says it was missing, expired or too old to carry age_ok, the session is refreshed once
// and the call tried again (retry.ts). In demo mode every call fails at once with network_error and
// nothing is sent: features return fixtures before they get here.

import { ApiError, createApiClient, type ApiClient } from '../core/api';
import { config } from './env';
import { singleFlight, withSessionRefresh } from './retry';
import { supabase } from './supabase';

async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  // getSession() refreshes first when the stored token has expired.
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** One refresh at a time, however many calls failed together. True when there is a new session. */
export const refreshSession = singleFlight(async (): Promise<boolean> => {
  if (!supabase) return false;
  const { data, error } = await supabase.auth.refreshSession();
  return !error && !!data.session;
});

const noNetwork: typeof fetch = () => Promise.reject(new ApiError(0, 'network_error'));

export const api: ApiClient = withSessionRefresh(
  createApiClient({
    baseUrl: config.apiUrl,
    getAccessToken,
    ...(config.demo ? { fetchImpl: noNetwork } : {}),
  }),
  refreshSession,
);
