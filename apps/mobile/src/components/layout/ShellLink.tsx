import { Link, type Href } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout } from '../../theme/tokens';

// Links for the web shell (top bar, footer). On the web they are real <a href> elements: they show the URL,
// open in a new tab with Cmd/Ctrl-click, work with Tab and Enter, and get a visible focus ring when reached
// by keyboard (not after a mouse click). In the native apps the same component is an ordinary pressable.

export interface InteractionState {
  hovered: boolean;
  pressed: boolean;
  /** Focused by keyboard (the browser's :focus-visible). */
  focusVisible: boolean;
}

/** The keyboard focus ring (web). Add it to a style when `focusVisible` is true. */
export const focusRing: ViewStyle = {
  outlineStyle: 'solid',
  outlineWidth: layout.focusRingWidth,
  outlineColor: colors.ink,
  outlineOffset: layout.focusRingOffset,
};

type FocusEventLike = { target?: unknown } | undefined;

function matchesFocusVisible(event: FocusEventLike): boolean {
  const el = event?.target as { matches?: (selector: string) => boolean } | undefined;
  if (!el || typeof el.matches !== 'function') return true;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true; // an old browser without :focus-visible: always show the ring
  }
}

/** Hover and keyboard-focus state for a Pressable (both stay false in the native apps). */
export function useInteraction() {
  const [hovered, setHovered] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);
  const onFocus = useCallback((event: unknown) => {
    if (Platform.OS === 'web') setFocusVisible(matchesFocusVisible(event as FocusEventLike));
  }, []);
  const onBlur = useCallback(() => setFocusVisible(false), []);
  return { hovered, focusVisible, handlers: { onHoverIn, onHoverOut, onFocus, onBlur } };
}

export interface ShellLinkProps {
  /** An app route ('/discover') or, with `external`, a full https URL. */
  href: Href | string;
  /** Opens in a new tab (web) or the in-app browser (native). */
  external?: boolean;
  /** aria-current on the web: 'page' for the current page, 'true' for its section. */
  current?: 'page' | 'true' | null;
  accessibilityLabel?: string;
  testID?: string;
  linkStyle: (state: InteractionState) => StyleProp<ViewStyle>;
  render: (state: InteractionState) => ReactNode;
}

// Expo Router's <Link asChild> hands its child href, role, onPress (and on the web onClick, rel, target).
// Its Slot spreads a style *object* over the child's style, so the style function travels as `linkStyle`.
type SlotProps = Record<string, unknown> & { target?: string; rel?: string; style?: unknown };

function Surface({
  linkStyle,
  render,
  current,
  accessibilityLabel,
  testID,
  target,
  rel,
  style: _slotStyle,
  ...slot
}: Omit<ShellLinkProps, 'href' | 'external'> & SlotProps) {
  const { hovered, focusVisible, handlers } = useInteraction();
  const web: Record<string, unknown> = {};
  if (Platform.OS === 'web') {
    if (current) web['aria-current'] = current;
    if (target || rel) web.hrefAttrs = { target, rel };
  }
  return (
    <Pressable
      {...slot}
      {...(web as object)}
      {...handlers}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => linkStyle({ hovered, pressed, focusVisible })}
    >
      {({ pressed }) => render({ hovered, pressed, focusVisible })}
    </Pressable>
  );
}

export function ShellLink({ href, external = false, ...rest }: ShellLinkProps) {
  if (external) {
    // A plain anchor (web) that the browser opens in a new tab; Expo Router's Link does the same for an
    // absolute URL with target="_blank" and opens it with Linking in the native apps.
    return (
      <Link href={href as Href} asChild target="_blank" rel="noopener noreferrer">
        <Surface {...rest} />
      </Link>
    );
  }
  return (
    <Link href={href as Href} asChild>
      <Surface {...rest} />
    </Link>
  );
}
