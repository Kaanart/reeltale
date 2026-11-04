import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import type { TagRow } from '../../../../lib/types';
import { space } from '../../../../theme/tokens';
import { tagLabel } from '../../logic';
import { DiscoverLink } from '../SeeAllLink';
import { SectionHeader } from './SectionHeader';

/** "Popular tags": the genres and tropes most series carry, each a link to Discover filtered by it. */
export function TagCloud({ tags }: { tags: readonly TagRow[] }) {
  const { t, i18n } = useTranslation();
  const title = t('home:home.store.popularTags');
  const web = Platform.OS === 'web';
  return (
    <View testID="home-tags">
      <SectionHeader title={title} />
      <View role={web ? 'list' : undefined} aria-label={title} style={styles.cloud}>
        {tags.map((tag) => {
          const label = tagLabel(tag, i18n.language);
          return (
            <View key={tag.id} role={web ? 'listitem' : undefined}>
              <DiscoverLink
                options={{ tagId: tag.id }}
                label={label}
                accessibilityLabel={t('home:home.store.tagA11y', { tag: label })}
                variant="chip"
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cloud: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
