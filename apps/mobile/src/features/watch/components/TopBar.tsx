// The player's top bar: back, and which series and episode this is. Floats over the video; white on the
// scrim so it reads over any frame. Reports its height so the pages can keep their notices below it.

import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';
import { IconButton } from './IconButton';

export interface TopBarProps {
  /** "Salt & Static · Episode 2"; nothing while the series is loading. */
  title: string | null;
  topInset: number;
  onBack: () => void;
  onHeight?: (height: number) => void;
}

export function TopBar({ title, topInset, onBack, onHeight }: TopBarProps) {
  const { t } = useTranslation();
  const onLayout = (e: LayoutChangeEvent) => onHeight?.(e.nativeEvent.layout.height);
  return (
    <View style={[styles.bar, { paddingTop: topInset + space.sm }]} pointerEvents="box-none" onLayout={onLayout}>
      <IconButton icon="chevron-back" label={t('watch:back')} onPress={onBack} testID="watch-back" />
      {title ? (
        <View style={styles.titlePill} pointerEvents="none">
          <Text variant="bodySmall" color="surface" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  titlePill: {
    flexShrink: 1,
    marginLeft: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
  },
});
