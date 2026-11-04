import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { shellStore } from './shellStore';

/**
 * Sets the browser tab's title to '<title> · ReelTale' while this screen is focused (web only; a no-op in
 * the native apps). Call it once, at the top of a screen component (not in a layout or a list row), with
 * text that is already translated:
 *
 *   usePageTitle(t('home:discover.title'));
 *   usePageTitle(series.data?.title);          // null/undefined/'' while loading: the default title stays
 *
 * Without a call, the tabs show their tab name and every other screen just 'ReelTale' (SiteShell). Never
 * put personal data (an email, a display name) in a title: browsers keep titles in history and sync them.
 */
export function usePageTitle(title: string | null | undefined): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || !title) return undefined;
      return shellStore.pushTitle(title);
    }, [title]),
  );
}

/**
 * Hides the web top bar while this screen is focused (a full-window player, an editor). Use sparingly:
 * the top bar is how people get around on a laptop. No effect in the native apps or on phone-sized windows.
 */
export function useHideTopNav(hidden = true): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || !hidden) return undefined;
      return shellStore.hideTopNav();
    }, [hidden]),
  );
}
