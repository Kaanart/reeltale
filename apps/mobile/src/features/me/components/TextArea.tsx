import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, radius, space, type as typeScale } from '../../../theme/tokens';

export interface TextAreaProps extends Omit<TextInputProps, 'style' | 'multiline'> {
  label: string;
  /** Shown under the box, right-aligned ("12 of 2,000"). */
  counter?: string;
}

const MIN_HEIGHT = 120;

// A labelled multi-line input (the auth feature's TextField is single-line).
export function TextArea({ label, counter, onFocus, onBlur, ...input }: TextAreaProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text variant="bodySmall" color="inkMuted" style={styles.label}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.inkMuted}
        maxFontSizeMultiplier={1.6}
        {...input}
        multiline
        textAlignVertical="top"
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[styles.input, focused && styles.focused]}
      />
      {counter ? (
        <Text variant="caption" color="inkMuted" align="right" style={styles.counter}>
          {counter}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { width: '100%' },
  label: { marginBottom: space.xs, fontFamily: fonts.sansMedium },
  input: {
    minHeight: MIN_HEIGHT,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: typeScale.body.fontSize,
  },
  focused: { borderColor: colors.ink },
  counter: { marginTop: space.xs },
});
