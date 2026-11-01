import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, space } from '../../../theme/tokens';

const ROW_MIN = 52;
const ICON = 20;

export interface NavRowProps {
  label: string;
  /** A short value on the right ("Plus", "240 coins"). */
  value?: string | null;
  /** Anything to show before the label (an icon). */
  leading?: ReactNode;
  onPress: () => void;
  /** 'link' for a row that opens a page outside the app. */
  role?: 'button' | 'link';
  accessibilityLabel?: string;
  testID?: string;
}

// A tappable row with a chevron (or an "open" arrow for external pages).
export function NavRow({ label, value, leading, onPress, role = 'button', accessibilityLabel, testID }: NavRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text variant="body" style={styles.label}>
        {label}
      </Text>
      {value ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.value}>
          {value}
        </Text>
      ) : null}
      <Ionicons
        name={role === 'link' ? 'open-outline' : 'chevron-forward'}
        size={ICON}
        color={colors.inkMuted}
        accessible={false}
      />
    </Pressable>
  );
}

// A label and its value, not tappable (the email address, how you signed in). Read as one line.
export function InfoRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View
      style={styles.info}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
    >
      <Text variant="bodySmall" color="inkMuted">
        {label}
      </Text>
      <Text variant="body" style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export interface RadioRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

const RADIO = 22;
const RADIO_DOT = 10;

// react-native-web colours the thumb of a switch that is on with its own teal (thumbColor is only the off
// thumb there); this keeps it the same white as in the apps. RN's types don't know the prop.
const WEB_SWITCH: object = Platform.OS === 'web' ? { activeThumbColor: colors.surface } : {};

// One choice of a group (wrap the rows in a View with accessibilityRole="radiogroup"). The selected one
// shows a filled dot, so the state doesn't rest on colour.
export function RadioRow({ label, selected, onPress, testID }: RadioRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      testID={testID}
      style={({ pressed }) => [styles.radioRow, pressed && styles.pressed]}
    >
      <View style={styles.radio}>{selected ? <View style={styles.radioDot} /> : null}</View>
      <Text variant="body" style={styles.radioLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface SwitchRowProps {
  label: string;
  body?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

// A switch with its label and explanation. The state is also written out ("On" / "Off"), so it never relies
// on the colour of the switch alone. The off track is inkMuted: the hairline colour is 1.3:1 on the card, so
// the switch itself all but disappeared (non-text contrast needs 3:1).
export function SwitchRow({ label, body, value, onValueChange, disabled = false, testID }: SwitchRowProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text variant="body" style={styles.switchLabel}>
          {label}
        </Text>
        {body ? (
          <Text variant="bodySmall" color="inkMuted" style={styles.body}>
            {body}
          </Text>
        ) : null}
      </View>
      {/* The switch announces its own state; the written one is for people who can see it. */}
      <Text variant="bodySmall" color="inkMuted" style={styles.state} aria-hidden>
        {t(value ? 'settings:toggle.on' : 'settings:toggle.off')}
      </Text>
      <Switch
        {...WEB_SWITCH}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={body}
        trackColor={{ false: colors.inkMuted, true: colors.success }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.inkMuted}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: ROW_MIN, paddingHorizontal: space.lg, paddingVertical: space.sm },
  pressed: { opacity: 0.6 },
  leading: { marginRight: space.md },
  label: { flex: 1, marginRight: space.sm },
  value: { marginRight: space.sm },
  info: { minHeight: ROW_MIN, justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm },
  infoValue: { marginTop: space.xs },
  radioRow: { flexDirection: 'row', alignItems: 'center', minHeight: ROW_MIN, paddingHorizontal: space.lg, paddingVertical: space.sm },
  radio: {
    width: RADIO,
    height: RADIO,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: RADIO / 2,
    backgroundColor: colors.surface,
  },
  radioDot: { width: RADIO_DOT, height: RADIO_DOT, borderRadius: RADIO_DOT / 2, backgroundColor: colors.ink },
  radioLabel: { flex: 1, marginLeft: space.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: ROW_MIN, paddingHorizontal: space.lg, paddingVertical: space.md },
  switchText: { flex: 1, marginRight: space.md },
  switchLabel: { fontFamily: fonts.sansMedium },
  body: { marginTop: space.xs },
  state: { marginRight: space.sm },
});
