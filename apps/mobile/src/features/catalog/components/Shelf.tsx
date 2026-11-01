import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { fonts, space } from '../../../theme/tokens';
import type { SeriesCard } from '../logic';
import { SeriesTile } from './SeriesTile';

// Wide enough for "Stop-motion · Completed" on one line (the meta line under a cover never wraps).
export const SHELF_CARD_WIDTH = 148;
export const SCREEN_GUTTER = space.lg;

export interface ShelfProps {
  title: string;
  items: readonly SeriesCard[];
  onOpen: (series: SeriesCard) => void;
  /** Shows "See all" in the header when given. */
  onSeeAll?: () => void;
}

/** A titled row of covers that scrolls sideways. Short (a dozen at most), so a plain scroll view is enough. */
export function Shelf({ title, items, onOpen, onSeeAll }: ShelfProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.shelf}>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {onSeeAll ? (
          <Pressable
            onPress={onSeeAll}
            accessibilityRole="link"
            accessibilityLabel={t('home:home.seeAllA11y', { title })}
            style={styles.seeAll}
          >
            <Text variant="bodySmall" style={styles.seeAllLabel}>
              {t('common:actions.seeAll')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityLabel={title}
      >
        {items.map((series) => (
          <SeriesTile key={series.id} series={series} width={SHELF_CARD_WIDTH} onPress={onOpen} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shelf: { marginTop: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SCREEN_GUTTER, marginBottom: space.md },
  title: { flex: 1 },
  seeAll: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  seeAllLabel: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
  row: { paddingHorizontal: SCREEN_GUTTER, gap: space.md },
});
