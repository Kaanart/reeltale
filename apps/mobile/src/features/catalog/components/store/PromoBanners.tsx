import type { Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type Ionicons from '@expo/vector-icons/Ionicons';

import { focusRing, ResponsiveGrid } from '../../../../components/layout';
import { Text } from '../../../../components/ui';
import { colors, radius, space, type ColorName } from '../../../../theme/tokens';
import { routes } from '../../routes';
import { CardLink } from '../CardLink';
import { DecorativeIcon } from '../DecorativeIcon';

const ICON = 40;
const SHAPE_LARGE = 140;
const SHAPE_SMALL = 72;
const MIN_HEIGHT = 136;

interface Banner {
  key: 'series' | 'creator' | 'ai';
  /** A function: Discover's address carries a fresh request id each time (routes.discover). */
  href: () => Href;
  background: ColorName;
  icon: ComponentProps<typeof Ionicons>['name'];
}

const BANNERS: Banner[] = [
  { key: 'series', href: () => routes.discover(), background: 'bannerTeal', icon: 'film-outline' },
  { key: 'creator', href: () => '/create' as Href, background: 'accentStrong', icon: 'videocam-outline' },
  { key: 'ai', href: () => routes.storyNew, background: 'ai', icon: 'sparkles-outline' },
];

/** Three coloured cards near the end of Home: Browse all series (Discover), Become a creator, Make a story with AI. */
export function PromoBanners() {
  const { t } = useTranslation();
  return (
    <ResponsiveGrid
      items={BANNERS}
      keyExtractor={(b) => b.key}
      columns={{ compact: 1, medium: 3, wide: 3 }}
      gap={space.lg}
      accessibilityLabel={t('home:home.store.banners.a11y')}
      testID="home-banners"
      renderItem={(b) => {
        const title = t(`home:home.store.banners.${b.key}.title`);
        const body = t(`home:home.store.banners.${b.key}.body`);
        return (
          <CardLink
            href={b.href()}
            accessibilityLabel={`${title}. ${body}`}
            cardStyle={(s) => [
              styles.banner,
              { backgroundColor: colors[b.background] },
              (s.hovered || s.pressed) && styles.hovered,
              s.focusVisible && focusRing,
            ]}
            render={(s) => (
              <>
                {/* Decoration: two soft circles and the section's icon. */}
                <View style={[styles.shape, styles.shapeLarge]} />
                <View style={[styles.shape, styles.shapeSmall]} />
                <View style={styles.icon}>
                  <DecorativeIcon name={b.icon} size={ICON} color="onAccent" />
                </View>
                <View style={styles.text}>
                  <Text variant="heading" color="onAccent" style={s.hovered && styles.underline}>
                    {title}
                  </Text>
                  <Text variant="bodySmall" color="onAccent">
                    {body}
                  </Text>
                </View>
              </>
            )}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: MIN_HEIGHT,
    justifyContent: 'flex-end',
    padding: space.xl,
    borderRadius: radius.sheet,
    overflow: 'hidden',
  },
  hovered: { opacity: 0.92 },
  shape: { position: 'absolute', borderRadius: radius.pill, backgroundColor: colors.bannerShape },
  shapeLarge: { width: SHAPE_LARGE, height: SHAPE_LARGE, top: -SHAPE_LARGE / 3, right: -SHAPE_LARGE / 4 },
  shapeSmall: { width: SHAPE_SMALL, height: SHAPE_SMALL, bottom: -SHAPE_SMALL / 3, right: SHAPE_LARGE / 2 },
  icon: { position: 'absolute', top: space.lg, right: space.lg },
  text: { gap: space.xs, paddingRight: ICON + space.lg },
  underline: { textDecorationLine: 'underline' },
});
