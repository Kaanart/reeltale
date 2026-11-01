// The vertical pager (iOS and Android): a FlashList with one full-height page per episode and native
// paging. The visible page is reported when a swipe settles, not halfway through, so the playing episode
// never flickers between two. A scrollTo() from the screen doesn't rely on that report: the screen sets the
// page itself. EpisodePager.web.tsx is the web version (CSS scroll snap and arrow keys).

import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useImperativeHandle, useRef, type ReactElement, type Ref } from 'react';
import { StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { EpisodeRow } from '../../../lib/types';
import { colors } from '../../../theme/tokens';
import { pageFromOffset } from '../logic/pager';

export interface EpisodePagerHandle {
  scrollTo: (index: number) => void;
}

export interface EpisodePagerProps {
  ref?: Ref<EpisodePagerHandle>;
  episodes: readonly EpisodeRow[];
  initialIndex: number;
  activeIndex: number;
  /** One page: the full height of the player area. */
  pageHeight: number;
  onIndexChange: (index: number) => void;
  /**
   * One page. FlashList recycles its cells, so the element must carry `key={episode.id}`: a recycled cell then
   * mounts a fresh page (and player) instead of keeping another episode's state.
   */
  renderPage: (episode: EpisodeRow, index: number) => ReactElement;
  /** Web only: arrow keys page while true (off while a sheet is open). */
  keyboardEnabled?: boolean;
}

export function EpisodePager({ ref, episodes, initialIndex, pageHeight, onIndexChange, renderPage }: EpisodePagerProps) {
  const listRef = useRef<FlashListRef<EpisodeRow>>(null);

  useImperativeHandle(ref, () => ({
    scrollTo: (index: number) => {
      void listRef.current?.scrollToOffset({ offset: index * pageHeight, animated: true });
    },
  }), [pageHeight]);

  const settle = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onIndexChange(pageFromOffset(e.nativeEvent.contentOffset.y, pageHeight, episodes.length));
  }, [onIndexChange, pageHeight, episodes.length]);

  return (
    <FlashList
      ref={listRef}
      data={episodes}
      keyExtractor={(e) => e.id}
      renderItem={({ item, index }) => renderPage(item, index)}
      // renderPage changes whenever anything a page shows changes (the visible page, sound, captions …).
      extraData={renderPage}
      initialScrollIndex={initialIndex}
      pagingEnabled
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      onMomentumScrollEnd={settle}
      // Render one page ahead and behind: the player window is ±1.
      drawDistance={pageHeight}
      style={{ ...styles.list, height: pageHeight }}
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.playerBg },
});
