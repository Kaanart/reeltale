// The web shell and layout primitives (README "Web layout"). Screens import from here.
//
//   useLayout()          size class (compact / medium / wide), gutter, hasTopNav
//   PageContainer        centred page column (max 1200), gutters, scroll, ends with SiteFooter on the web
//   ResponsiveGrid       cards in as many columns as fit
//   TwoColumn            main + side panel on wide windows, stacked below
//   SiteFooter           the web footer (medium/wide); place it yourself only in a screen that scrolls itself
//   usePageTitle(t)      '<t> · ReelTale' in the browser tab while the screen is focused
//   useHideTopNav()      hide the web top bar while the screen is focused (full-window players)
//   ShellLink, focusRing, useInteraction   web links with hover and keyboard focus ring
//   SiteShell, SiteHeader                  used by the root layout only

export { PageContainer } from './PageContainer';
export type { PageContainerProps } from './PageContainer';
export { ResponsiveGrid } from './ResponsiveGrid';
export type { GridItemInfo, ResponsiveGridProps } from './ResponsiveGrid';
export { TwoColumn } from './TwoColumn';
export type { TwoColumnProps } from './TwoColumn';
export { SiteFooter } from './SiteFooter';
export { SiteHeader } from './SiteHeader';
export type { SiteHeaderProps } from './SiteHeader';
export { SiteShell } from './SiteShell';
export type { SiteShellProps } from './SiteShell';
export { focusRing, ShellLink, useInteraction } from './ShellLink';
export type { InteractionState, ShellLinkProps } from './ShellLink';
export { useLayout } from './useLayout';
export type { LayoutInfo } from './useLayout';
export { useHideTopNav, usePageTitle } from './usePageTitle';
export {
  activeNavKey, columnWidth, formatPageTitle, gridColumns, gridItemWidth, gutterFor, layoutSizeFor, maxWidthFor,
  NAV_ITEMS, navMatch,
} from './logic';
export type { ContentWidth, LayoutSize, NavItem, NavKey } from './logic';
