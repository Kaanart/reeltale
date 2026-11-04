import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextStyle } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { colors, layout, radius, space, type as typeScale } from '../../../theme/tokens';
import { MAX_SEARCH_LENGTH } from '../logic';
import { DecorativeIcon } from './DecorativeIcon';

const HEIGHT = 48;
// The browser's own outline would sit inside the rounded field; the field's border shows focus instead.
const NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as unknown as TextStyle;

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** To focus the field from the screen (Discover opened from the search button). */
  inputRef?: Ref<TextInput>;
}

export function SearchField({ value, onChangeText, placeholder, inputRef }: SearchFieldProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      <DecorativeIcon name="search" size={20} color="inkMuted" />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        accessibilityLabel={placeholder}
        returnKeyType="search"
        enterKeyHint="search"
        inputMode="search"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={MAX_SEARCH_LENGTH}
        maxFontSizeMultiplier={1.6}
        style={[styles.input, NO_OUTLINE]}
      />
      {value.length > 0 ? <ClearButton label={t('common:actions.clear')} onPress={() => onChangeText('')} /> : null}
    </View>
  );
}

function ClearButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.clear, hovered && styles.clearHover, focusVisible && focusRing]}
    >
      <DecorativeIcon name="close-circle" size={20} color={hovered ? 'ink' : 'inkMuted'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HEIGHT,
    paddingLeft: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  // The ink border (2 px, as the focus ring) shows where typing goes, on every platform.
  fieldFocused: { borderColor: colors.ink, borderWidth: 2, paddingLeft: space.md - 1 },
  input: {
    flex: 1,
    minHeight: HEIGHT - 2,
    paddingHorizontal: space.sm,
    color: colors.ink,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.fontSize,
  },
  clear: { width: layout.minTarget, height: layout.minTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  clearHover: { backgroundColor: colors.surfaceAlt },
});
