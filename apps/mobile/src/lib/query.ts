// The TanStack Query client. Retries follow retry.ts (never a 4xx, at most twice); mutations never retry
// on their own (an unlock or an AI start costs coins: the user decides to try again). Keys are
// user-scoped (keys.ts), and sign-out clears everything.

import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { retryDelay, shouldRetryQuery } from './retry';

export { authKeys, userKey } from './keys';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});

// On the web the browser's focus events drive refetch-on-focus; in the apps it's the app coming to the foreground.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => sub.remove();
  });
}

/** Drop every cached query and stop the running ones. Called on sign-out (and on a user switch). */
export function clearUserData(): void {
  void queryClient.cancelQueries();
  queryClient.clear();
}
