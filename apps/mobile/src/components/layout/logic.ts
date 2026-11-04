// Pure layout logic for the web shell (no React, no React Native), tested in
// src/core/__tests__/layout.test.ts. The components in this folder turn it into views.

import { normalizePath } from '../../lib/gate.ts';
import { breakpoints, layout } from '../../theme/tokens.ts';

export { normalizePath };

// ---- Size classes --------------------------------------------------------------------------------------

/** compact < 768 <= medium < 1100 <= wide (window width, in CSS px / points). */
export type LayoutSize = 'compact' | 'medium' | 'wide';

/**
 * The size class of a window this wide. Anything that isn't a positive finite number (a server render, the
 * first frame before the window is measured) counts as compact: phones first, and wider screens re-render.
 */
export function layoutSizeFor(width: number): LayoutSize {
  if (!Number.isFinite(width) || width <= 0) return 'compact';
  if (width >= breakpoints.wide) return 'wide';
  if (width >= breakpoints.medium) return 'medium';
  return 'compact';
}

/** Side gutter of a page for each size class. */
export function gutterFor(size: LayoutSize): number {
  if (size === 'wide') return layout.gutterWide;
  if (size === 'medium') return layout.gutterMedium;
  return layout.gutterCompact;
}

export type ContentWidth = 'content' | 'reading' | 'narrow' | 'full';

/** The widest a page's column gets; null = no cap (full bleed). */
export function maxWidthFor(width: ContentWidth): number | null {
  switch (width) {
    case 'content': return layout.contentMaxWidth;
    case 'reading': return layout.readingMaxWidth;
    case 'narrow': return layout.narrowMaxWidth;
    case 'full': return null;
  }
}

/** The width the column inside a page actually gets in a window this wide (gutters taken off). */
export function columnWidth(windowWidth: number, width: ContentWidth = 'content'): number {
  const size = layoutSizeFor(windowWidth);
  const inner = Math.max(0, (Number.isFinite(windowWidth) ? windowWidth : 0) - 2 * gutterFor(size));
  const cap = maxWidthFor(width);
  return cap === null ? inner : Math.min(inner, cap);
}

// ---- Grids ---------------------------------------------------------------------------------------------

export interface GridOptions {
  /** Narrowest an item may get; columns are added while every item stays at least this wide. */
  minItemWidth: number;
  /** Space between items (both directions). */
  gap: number;
  /** Never more columns than this. */
  maxColumns?: number;
  /** Never fewer columns than this (items may then get narrower than minItemWidth). Default 1. */
  minColumns?: number;
}

/** How many columns fit in `width`: the most that keep each item at least minItemWidth wide. */
export function gridColumns(width: number, { minItemWidth, gap, maxColumns = Infinity, minColumns = 1 }: GridOptions): number {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const min = Math.max(1, minItemWidth);
  const fit = Math.floor((w + gap) / (min + gap));
  const floor = Math.max(1, Math.floor(minColumns));
  const ceiling = Math.max(floor, Math.floor(maxColumns));
  return Math.min(ceiling, Math.max(floor, fit));
}

/** Width of one item in a grid of `columns` across `width` with `gap` between items (whole px, rounded down). */
export function gridItemWidth(width: number, columns: number, gap: number): number {
  const cols = Math.max(1, Math.floor(columns));
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  return Math.max(0, Math.floor((w - gap * (cols - 1)) / cols));
}

// ---- Navigation ----------------------------------------------------------------------------------------

export type NavKey = 'home' | 'discover' | 'create' | 'library' | 'me';

export interface NavItem {
  key: NavKey;
  /** The file name in src/app/(tabs). */
  route: 'index' | 'discover' | 'create' | 'library' | 'me';
  /** The URL. */
  href: '/' | '/discover' | '/create' | '/library' | '/me';
  /** common:nav.* */
  labelKey: string;
  /** Ionicons names: outlined when idle, filled when active. */
  icon: string;
  activeIcon: string;
}

/** The five tabs, in order. The bottom tab bar (phones, native) and the web top bar both use this list. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', route: 'index', href: '/', labelKey: 'common:nav.home', icon: 'home-outline', activeIcon: 'home' },
  { key: 'discover', route: 'discover', href: '/discover', labelKey: 'common:nav.discover', icon: 'compass-outline', activeIcon: 'compass' },
  { key: 'create', route: 'create', href: '/create', labelKey: 'common:nav.create', icon: 'add-circle-outline', activeIcon: 'add-circle' },
  { key: 'library', route: 'library', href: '/library', labelKey: 'common:nav.library', icon: 'library-outline', activeIcon: 'library' },
  { key: 'me', route: 'me', href: '/me', labelKey: 'common:nav.me', icon: 'person-circle-outline', activeIcon: 'person-circle' },
];

/** Paths that belong to a tab's section without being the tab itself (marked active, but not the current page). */
const SECTIONS: Record<NavKey, readonly string[]> = {
  home: [],
  discover: [],
  create: ['/story'],
  library: [],
  me: ['/settings', '/vip', '/redeem'],
};

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * How a nav link relates to the current path: 'page' when it is the page (aria-current="page"), 'section'
 * when the page is inside the link's section (aria-current="true"), otherwise null.
 */
export function navMatch(pathname: string, key: NavKey): 'page' | 'section' | null {
  const path = normalizePath(pathname);
  const item = NAV_ITEMS.find((i) => i.key === key);
  if (!item) return null;
  if (path === item.href) return 'page';
  return SECTIONS[key].some((prefix) => under(path, prefix)) ? 'section' : null;
}

/** The nav item the path belongs to (page or section), if any. */
export function activeNavKey(pathname: string): NavKey | null {
  return NAV_ITEMS.find((i) => navMatch(pathname, i.key) !== null)?.key ?? null;
}

/** The wallet chip in the top bar is the current page on /wallet. */
export function isWalletPath(pathname: string): boolean {
  return normalizePath(pathname) === '/wallet';
}

// ---- Page titles ---------------------------------------------------------------------------------------

/** The separator between the page and the app name: "Discover · ReelTale". */
export const TITLE_SEPARATOR = ' · ';

/** '<Page> · ReelTale', or just the app name when there is no page title (or it already is the app name). */
export function formatPageTitle(page: string | null | undefined, appName: string): string {
  const p = (page ?? '').replace(/\s+/g, ' ').trim();
  if (p === '' || p === appName) return appName;
  return `${p}${TITLE_SEPARATOR}${appName}`;
}

/** The i18n key of the default title for a path (the tabs), used until a screen sets its own. */
export function defaultTitleKey(pathname: string): string | null {
  const path = normalizePath(pathname);
  return NAV_ITEMS.find((i) => i.href === path)?.labelKey ?? null;
}
