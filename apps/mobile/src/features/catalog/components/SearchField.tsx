import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, radius, space, type as typeScale } from '../../../theme/tokens';
import { MAX_SEARCH_LENGTH } from '../logic';
import { DecorativeIcon } from './DecorativeIcon';

const HEIGHT = 48;

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}

export function SearchField({ value, onChangeText, placeholder }: SearchFieldProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <DecorativeIcon name="search" size={20} color="inkMuted" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
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
        style={styles.input}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.clear')}
          style={styles.clear}
        >
          <DecorativeIcon name="close-circle" size={20} color="inkMuted" />
        </Pressable>
      ) : null}
    </View>
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
  input: {
    flex: 1,
    minHeight: HEIGHT,
    paddingHorizontal: space.sm,
    color: colors.ink,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.fontSize,
  },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
