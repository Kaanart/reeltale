import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, radius, space } from '../../../theme/tokens';

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A few tabs side by side (Library: Following, History). */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={[styles.item, selected && styles.itemSelected]}
          >
            <Text variant="bodySmall" style={selected ? styles.labelSelected : styles.label} color={selected ? 'ink' : 'inkMuted'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
  },
  item: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  itemSelected: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.sansMedium },
  labelSelected: { fontFamily: fonts.sansBold },
});
