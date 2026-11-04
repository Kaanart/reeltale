import type { Href } from 'expo-router';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { focusRing } from '../../../../components/layout';
import { Text } from '../../../../components/ui';
import { demoCover, demoPanelImage, DEMO_PANEL_KEYS } from '../../../../demo';
import { colors, fonts, radius, space } from '../../../../theme/tokens';
import { routes } from '../../routes';
import { CardLink } from '../CardLink';
import { SectionHeader } from './SectionHeader';

const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 72;

interface Row {
  key: 'ai' | 'creator' | 'about';
  href: Href;
  image: ImageSourcePropType | null;
}

// Pictures bundled with the app (the sample catalog's art), so the list needs no network.
const ROWS: Row[] = [
  { key: 'ai', href: routes.storyNew, image: demoPanelImage(DEMO_PANEL_KEYS[1] ?? '') },
  { key: 'creator', href: '/create' as Href, image: demoCover('paper-moons') },
  { key: 'about', href: '/about' as Href, image: demoCover('salt-and-static') },
];

/** "Meet ReelTale": three ways in beside the carousel: make an AI story, become a creator, how it works. */
export function MeetReelTale() {
  const { t } = useTranslation();
  return (
    <View testID="home-meet">
      <SectionHeader title={t('home:home.store.meet.title')} />
      <View style={styles.list}>
        {ROWS.map((row, i) => {
          const title = t(`home:home.store.meet.${row.key}.title`);
          const body = t(`home:home.store.meet.${row.key}.body`);
          return (
            <CardLink
              key={row.key}
              href={row.href}
              accessibilityLabel={`${title}. ${body}`}
              cardStyle={(s) => [styles.row, i > 0 && styles.divider, s.pressed && styles.pressed, s.focusVisible && focusRing]}
              render={(s) => (
                <>
                  <View style={styles.text}>
                    <Text variant="subheading" numberOfLines={1} style={[styles.title, s.hovered && styles.titleHover]}>
                      {title}
                    </Text>
                    <Text variant="bodySmall" color="inkMuted" numberOfLines={2}>
                      {body}
                    </Text>
                  </View>
                  {row.image ? (
                    <Image source={row.image} alt="" accessible={false} contentFit="cover" style={styles.thumb} />
                  ) : null}
                </>
              )}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.chip,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0, gap: space.xs },
  title: { fontFamily: fonts.serifBold },
  titleHover: { textDecorationLine: 'underline' },
  thumb: { width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: radius.chip, backgroundColor: colors.surfaceAlt },
});
