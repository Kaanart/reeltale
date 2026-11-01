// The vertical pager on the web: a ScrollView with paging, which react-native-web turns into CSS scroll
// snap (one snap point per page). FlashList's recycled cells don't snap one by one in a browser, and a
// series has few enough episodes to render every page: pages outside the window render nearly nothing
// (logic/pager.ts pageRole). The page is read when scrolling stops; the arrow keys, Page Up/Down, Home
// and End move one page. Same props as EpisodePager.tsx.

import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { colors } from '../../../theme/tokens';
import { pageForKey, pageFromOffset } from '../logic/pager';
import type { EpisodePagerProps } from './EpisodePager';

/** Scroll events stop this long before the page counts as settled (smooth snapping keeps firing them). */
const SETTLE_MS = 120;

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function EpisodePager({
  ref, episodes, initialIndex, activeIndex, pageHeight, onIndexChange, renderPage, keyboardEnabled = true,
}: EpisodePagerProps) {
  const scrollRef = useRef<ScrollView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = episodes.length;

  const scrollTo = useCallback((index: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ y: index * pageHeight, animated });
  }, [pageHeight]);

  useImperativeHandle(ref, () => ({ scrollTo: (index: number) => scrollTo(index, true) }), [scrollTo]);

  // Open on the requested episode, and stay on the visible one when the window is resized.
  const active = useRef(activeIndex);
  active.current = activeIndex;
  const opened = useRef(false);
  useEffect(() => {
    const index = opened.current ? active.current : initialIndex;
    opened.current = true;
    const frame = requestAnimationFrame(() => scrollTo(index, false));
    return () => cancelAnimationFrame(frame);
  }, [initialIndex, scrollTo]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => onIndexChange(pageFromOffset(y, pageHeight, count)), SETTLE_MS);
  }, [onIndexChange, pageHeight, count]);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  useEffect(() => {
    if (!keyboardEnabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typingInto(e.target)) return;
      const next = pageForKey(e.key, active.current, count);
      if (next === null) return;
      e.preventDefault();
      scrollTo(next, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardEnabled, count, scrollTo]);

  return (
    <ScrollView
      ref={scrollRef}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={32}
      style={[styles.list, { height: pageHeight }]}
    >
      {episodes.map((episode, index) => (
        <View key={episode.id} style={{ height: pageHeight }}>
          {renderPage(episode, index)}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.playerBg },
});
