import { Platform } from 'react-native';

// Small accessibility helpers for the catalog's web pages. Each one does nothing in the native apps.

/**
 * The level of a Text with accessibilityRole="header" on the web: react-native-web renders every header as
 * <h1> unless it gets one, so a page's sections would read as a flat list of page titles. Spread it into the
 * Text: `<Text accessibilityRole="header" {...headingLevel(2)}>`. The native apps have no heading levels.
 */
export function headingLevel(level: 1 | 2 | 3): object | null {
  return Platform.OS === 'web' ? { 'aria-level': level } : null;
}

/**
 * Web: true when the keyboard focus has nowhere left to be, because the control that had it was removed or
 * disabled (a disabled <button> drops the focus to the page). `from`, when given, is that control: some
 * browsers leave the focus on it after it turns disabled, which counts as lost too.
 */
export function focusWasLost(from?: unknown): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const active = document.activeElement;
  return !active || active === document.body || (from != null && active === from);
}

type QueryableNode = { querySelectorAll?: (selector: string) => ArrayLike<{ focus?: () => void }> };

/** Web: focus the `index`-th element matching `selector` inside a View (a react-native-web ref is its DOM node). */
export function focusNth(container: unknown, selector: string, index: number): void {
  if (Platform.OS !== 'web' || !container) return;
  (container as QueryableNode).querySelectorAll?.(selector)[index]?.focus?.();
}
