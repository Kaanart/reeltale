import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { useInteraction, type InteractionState } from '../../../components/layout';

// A card that opens a page (a series, an episode). On the web it is a real <a href>: the address shows on
// hover, Cmd/Ctrl-click opens a new tab, Tab and Enter work, and the card knows when it is hovered or has the
// keyboard focus (to show the focus ring). In the native apps it is an ordinary pressable that pushes the
// page, as router.push did before.

export interface CardLinkProps {
  href: Href;
  /** Read instead of the card's contents; must name the AI and Mature labels inside (useSeriesText). */
  accessibilityLabel: string;
  cardStyle: (state: InteractionState) => StyleProp<ViewStyle>;
  render: (state: InteractionState) => ReactNode;
  testID?: string;
}

// Expo Router's <Link asChild> hands its child href, role and onPress (onClick on the web). Its Slot spreads
// a style object over the child's, so the style function travels under another name.
//
// On the web, react-native-web's Pressable puts its own onClick after the props it is given, so the Link's
// onClick would never run and the browser would follow the <a href> with a full page load (losing the demo's
// in-memory state). The Pressable's onPress is called from that onClick with the click event, so the Link's
// handler goes there: a plain click navigates inside the app, while Cmd/Ctrl/Shift-click and middle-click
// are left to the browser (new tab or window), as the handler itself decides.
type PressHandler = (event: GestureResponderEvent) => void;
type SlotProps = Record<string, unknown> & { style?: unknown; onClick?: PressHandler; onPress?: PressHandler };

function Surface({
  cardStyle,
  render,
  accessibilityLabel,
  testID,
  style: _slotStyle,
  onClick,
  onPress,
  ...slot
}: Omit<CardLinkProps, 'href'> & SlotProps) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...slot}
      {...handlers}
      onPress={Platform.OS === 'web' ? (onClick ?? onPress) : onPress}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => cardStyle({ hovered, pressed, focusVisible })}
    >
      {({ pressed }) => render({ hovered, pressed, focusVisible })}
    </Pressable>
  );
}

export function CardLink({ href, ...rest }: CardLinkProps) {
  return (
    <Link href={href} push asChild>
      <Surface {...rest} />
    </Link>
  );
}
