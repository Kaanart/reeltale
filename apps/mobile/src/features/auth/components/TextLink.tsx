import { Pressable, StyleSheet } from 'react-native';

import { Text } from '../../../components/ui';
import { space } from '../../../theme/tokens';

// A text-only action (underlined ink: the accent colour is too light for small text on paper).
export interface TextLinkProps {
  label: string;
  onPress: () => void;
  /** 'link' for something that opens a page, 'button' for an action in the app. */
  role?: 'link' | 'button';
  accessibilityHint?: string;
  size?: 'body' | 'bodySmall';
  disabled?: boolean;
  testID?: string;
}

const MIN_TARGET = 44;

export function TextLink({ label, onPress, role = 'button', accessibilityHint, size = 'bodySmall', disabled = false, testID }: TextLinkProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.target, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text variant={size} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.sm,
  },
  label: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
