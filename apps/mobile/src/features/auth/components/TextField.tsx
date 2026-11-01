import { useState, type Ref } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, radius, space, type as typeScale } from '../../../theme/tokens';

// A labelled text input. Generic enough for other forms; lives here until it moves to components/ui.
export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field in the danger colour and announced. */
  error?: string | null;
  /** Shown under the field when there is no error. */
  hint?: string | null;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<TextInput>;
}

const HEIGHT = 48;

export function TextField({ label, error, hint, style, ref, onFocus, onBlur, ...input }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, style]}>
      <Text variant="bodySmall" color="inkMuted" style={styles.label}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.inkMuted}
        maxFontSizeMultiplier={1.6}
        {...input}
        accessibilityHint={error ?? hint ?? undefined}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[styles.input, focused && styles.focused, !!error && styles.invalid]}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite" style={styles.below}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="inkMuted" style={styles.below}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { width: '100%' },
  label: { marginBottom: space.xs, fontFamily: fonts.sansMedium },
  input: {
    minHeight: HEIGHT,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: typeScale.body.fontSize,
  },
  focused: { borderColor: colors.ink },
  invalid: { borderColor: colors.danger },
  below: { marginTop: space.xs },
});
