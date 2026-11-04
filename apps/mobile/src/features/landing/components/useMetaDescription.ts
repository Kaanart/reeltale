import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

/**
 * The page's <meta name="description"> while the screen is focused (web only), for search engines that run
 * scripts and for browser previews. The previous value comes back when the screen loses focus. Pass text
 * that is already translated, and never anything personal.
 */
export function useMetaDescription(content: string | null | undefined): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || typeof document === 'undefined' || !content) return undefined;
      let el = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
      const created = el === null;
      if (el === null) {
        el = document.createElement('meta');
        el.name = 'description';
        document.head.appendChild(el);
      }
      const meta = el;
      const previous = meta.content;
      meta.content = content;
      return () => {
        if (created) meta.remove();
        else meta.content = previous;
      };
    }, [content]),
  );
}
