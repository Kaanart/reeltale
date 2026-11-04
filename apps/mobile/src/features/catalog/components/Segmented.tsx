import { Pressable, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A few tabs side by side (Library: Following, History). */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {options.map((option) => (
        <Segment
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

function Segment({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      // aria-* rather than accessibilityState: react-native-web only renders aria-selected from this prop.
      aria-selected={selected}
      style={[styles.item, selected && styles.itemSelected, hovered && !selected && styles.itemHover, focusVisible && focusRing]}
    >
      <Text variant="bodySmall" style={selected ? styles.labelSelected : styles.label} color={selected ? 'ink' : 'inkMuted'}>
        {label}
      </Text>
    </Pressable>
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
    minHeight: layout.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  itemSelected: { backgroundColor: colors.surface },
  // Muted labels keep 4.5:1 on the page colour (on `line` they would drop just under it).
  itemHover: { backgroundColor: colors.bg },
  label: { fontFamily: fonts.sansMedium },
  labelSelected: { fontFamily: fonts.sansBold },
});
