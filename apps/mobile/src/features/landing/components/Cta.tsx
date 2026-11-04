import type { Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { focusRing, ShellLink, useInteraction, type InteractionState } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';

// The public pages' calls to action. A link (it goes somewhere: a real <a href> on the web) and a button
// (it does something: the demo sign-in) look the same, so the hero can mix them. Primary is white on
// accentStrong (5.5:1); secondary is ink on white with a line.

export type CtaVariant = 'primary' | 'secondary';

interface CommonProps {
  label: string;
  variant?: CtaVariant;
  testID?: string;
  /** Stretch to the container's width (phones). */
  block?: boolean;
}

export function CtaLink({ href, label, variant = 'primary', testID, block = false }: CommonProps & { href: string }) {
  return (
    <ShellLink
      href={href as Href}
      accessibilityLabel={label}
      testID={testID}
      linkStyle={(s) => frameStyle(variant, s, block)}
      render={() => <CtaLabel label={label} variant={variant} />}
    />
  );
}

export function CtaButton({ onPress, label, variant = 'primary', testID, block = false, busy = false }: CommonProps & {
  onPress: () => void;
  /** Working (sending): presses are ignored and the button says so (aria-busy). It stays focusable. */
  busy?: boolean;
}) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      aria-busy={busy}
      onPress={busy ? undefined : onPress}
      testID={testID}
      {...handlers}
      style={({ pressed }) => frameStyle(variant, { hovered: hovered && !busy, pressed: pressed && !busy, focusVisible }, block)}
    >
      <CtaLabel label={label} variant={variant} />
    </Pressable>
  );
}

function CtaLabel({ label, variant }: { label: string; variant: CtaVariant }) {
  return (
    <Text variant="body" color={variant === 'primary' ? 'onAccent' : 'ink'} style={styles.label} numberOfLines={1}>
      {label}
    </Text>
  );
}

function frameStyle(variant: CtaVariant, s: InteractionState, block: boolean) {
  const active = s.hovered || s.pressed;
  return [
    styles.base,
    variant === 'primary' ? styles.primary : styles.secondary,
    active && (variant === 'primary' ? styles.primaryActive : styles.secondaryActive),
    block && styles.block,
    s.focusVisible && focusRing,
  ];
}

/** Height of a hero button: a 44 pt target plus room for a 16 pt label to breathe. */
const HEIGHT = layout.minTarget + space.xs;

const styles = StyleSheet.create({
  base: {
    minHeight: HEIGHT,
    minWidth: layout.minTarget,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.accentStrong, borderColor: colors.accentStrong },
  primaryActive: { backgroundColor: colors.accentStrongPressed, borderColor: colors.accentStrongPressed },
  secondary: { backgroundColor: colors.surface, borderColor: colors.line },
  secondaryActive: { borderColor: colors.ink },
  block: { alignSelf: 'stretch', width: '100%' },
  label: { fontFamily: fonts.sansBold },
});
