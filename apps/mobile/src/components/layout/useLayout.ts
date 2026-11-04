import { useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { gutterFor, layoutSizeFor, type LayoutSize } from './logic';

export interface LayoutInfo {
  /** compact < 768 <= medium < 1100 <= wide, by window width. */
  size: LayoutSize;
  width: number;
  height: number;
  isCompact: boolean;
  isMedium: boolean;
  isWide: boolean;
  isWeb: boolean;
  /**
   * The web at medium or wide: the top bar replaces the bottom tabs and pages end with the site footer.
   * Always false in the native apps and on phone-sized browser windows.
   */
  hasTopNav: boolean;
  /** Side gutter for this size class (layout.gutter* tokens). */
  gutter: number;
}

/**
 * The window's size class and what the shell shows at it. Re-renders when the window is resized. Before the
 * window is measured (a server render, or a width of 0) it answers 'compact', so nothing wide flashes on a
 * phone.
 */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions();
  return useMemo(() => {
    const size = layoutSizeFor(width);
    const isWeb = Platform.OS === 'web';
    return {
      size,
      width,
      height,
      isCompact: size === 'compact',
      isMedium: size === 'medium',
      isWide: size === 'wide',
      isWeb,
      hasTopNav: isWeb && size !== 'compact',
      gutter: gutterFor(size),
    };
  }, [width, height]);
}
