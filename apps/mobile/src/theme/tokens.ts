// Design tokens (prep/SCREEN_SPECS.md). Components import from here; no raw colour values elsewhere.

export const colors = {
  bg: '#FBF9F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F3EFE8',
  ink: '#1E1B18',
  inkMuted: '#6B645C',
  line: '#E7E1D8',
  accent: '#E8553D',
  accentPressed: '#C8432E',
  // The brand accent is decoration only: white on it is 3.6:1. Text-bearing accent surfaces (primary buttons,
  // selected chips) and accent-coloured text use accentStrong: white on it is 5.5:1, on bg 5.3:1 (same hue).
  // Checked in src/core/__tests__/contrast.test.ts.
  accentStrong: '#BF3722',
  accentStrongPressed: '#A42713',
  /** Text and icons on accentStrong. */
  onAccent: '#FFFFFF',
  coin: '#F2B33D',
  ai: '#5B5BD6',
  success: '#2F9E6E',
  warn: '#D98E04',
  danger: '#D64545',
  playerBg: '#000000',
  scrim: 'rgba(0,0,0,0.55)',
} as const;

export type ColorName = keyof typeof colors;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// Web layout (src/components/layout, README "Web layout"). Window width decides the size class:
// compact < medium (768) <= medium < wide (1100) <= wide.
export const breakpoints = {
  medium: 768,
  wide: 1100,
} as const;

export const layout = {
  /** Widest a page's content column gets (PageContainer width="content"). */
  contentMaxWidth: 1200,
  /** Long text and single-column screens (series page, settings). */
  readingMaxWidth: 760,
  /** Forms and small panels. */
  narrowMaxWidth: 560,
  /** Side gutters per size class. */
  gutterCompact: 16,
  gutterMedium: 24,
  gutterWide: 32,
  /** The web top navigation bar. */
  navHeight: 64,
  /** TwoColumn's side panel. */
  sidePanelWidth: 360,
  /** Keyboard focus ring on web. */
  focusRingWidth: 2,
  focusRingOffset: 2,
  /** Smallest touch / click target. */
  minTarget: 44,
} as const;

export const radius = {
  chip: 8,
  card: 12,
  sheet: 20,
  pill: 999,
} as const;

export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;

// Font family names must match the keys passed to useFonts() in the root layout.
export const fonts = {
  serif: 'Literata',
  serifBold: 'Literata-Bold',
  sans: 'Inter',
  sansMedium: 'Inter-Medium',
  sansBold: 'Inter-Bold',
} as const;

export interface TextToken {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight?: '400' | '500' | '600' | '700';
}

export type TypeVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodySmall'
  | 'caption';

// Weight is carried by the font family name, so fontWeight is left unset.
// Every size has an explicit lineHeight (1.3 to 1.45 times the size) to avoid clipped glyphs.
export const type: Record<TypeVariant, TextToken> = {
  display: { fontFamily: fonts.serifBold, fontSize: 34, lineHeight: 44 },
  title: { fontFamily: fonts.serifBold, fontSize: 28, lineHeight: 38 },
  heading: { fontFamily: fonts.serifBold, fontSize: 22, lineHeight: 30 },
  subheading: { fontFamily: fonts.sansMedium, fontSize: 18, lineHeight: 26 },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
  bodySmall: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16 },
};

export const theme = {
  colors,
  space,
  breakpoints,
  layout,
  radius,
  motion,
  fonts,
  type,
} as const;

export type Theme = typeof theme;
