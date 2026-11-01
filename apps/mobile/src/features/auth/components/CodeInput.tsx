import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { CODE_LENGTH, cleanCode } from '../validation';

// Six boxes over one real text field: typing, pasting and the system's one-time-code autofill all go
// into the field, the boxes only show it. Screen readers see a single labelled field.
export interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Called once the last digit is in. */
  onComplete?: (code: string) => void;
  label: string;
  invalid?: boolean;
  autoFocus?: boolean;
}

const BOX_HEIGHT = 56;
const BOX_MAX_WIDTH = 52;

export function CodeInput({ value, onChange, onComplete, label, invalid = false, autoFocus = true }: CodeInputProps) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable onPress={() => input.current?.focus()} accessible={false} style={styles.wrap}>
      <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const active = focused && i === Math.min(value.length, CODE_LENGTH - 1);
          return (
            <View key={i} style={[styles.box, active && styles.boxActive, invalid && styles.boxInvalid]}>
              <Text variant="heading" style={styles.digit}>
                {value[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => {
          const code = cleanCode(text);
          onChange(code);
          if (code.length === CODE_LENGTH && code !== value) onComplete?.(code);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={CODE_LENGTH}
        caretHidden
        accessibilityLabel={label}
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  box: {
    flex: 1,
    maxWidth: BOX_MAX_WIDTH,
    height: BOX_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  boxActive: { borderColor: colors.ink, borderWidth: 2 },
  boxInvalid: { borderColor: colors.danger },
  digit: { fontFamily: fonts.sansBold },
  // Covers the boxes so a tap lands in the field; its own text is invisible.
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    color: 'transparent',
    backgroundColor: 'transparent',
    opacity: 0.02,
  },
});
