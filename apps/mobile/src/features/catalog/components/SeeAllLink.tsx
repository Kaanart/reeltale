import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { isPlainClick, type ClickLike } from '../layout';
import { routes, type DiscoverOptions } from '../routes';

const TAG_HEIGHT = 32;
// Brings a tag's touch area to 44.
const TAG_SLOP = { top: (layout.minTarget - TAG_HEIGHT) / 2, bottom: (layout.minTarget - TAG_HEIGHT) / 2 } as const;

/**
 * A link to Discover on one ranking or tag. The target gets a fresh request id when it is followed
 * (routes.discover), so asking for the same ranking again still resets Discover's chips. On the web it is a
 * real <a href> (keyboard, Cmd-click for a new tab); a plain click navigates inside the app.
 *
 *   'text': "See all" next to a shelf         'tag': a tag chip on the series page
 */
export function DiscoverLink({
  options, label, accessibilityLabel, variant,
}: { options: DiscoverOptions; label: string; accessibilityLabel: string; variant: 'text' | 'tag' }) {
  const router = useRouter();
  const { hovered, focusVisible, handlers } = useInteraction();
  const web = Platform.OS === 'web';

  const onPress = (event: GestureResponderEvent) => {
    if (web) {
      // Modified clicks open the link's own address in a new tab: leave those to the browser.
      if (!isPlainClick(event.nativeEvent as unknown as ClickLike)) return;
      event.preventDefault();
    }
    router.navigate(routes.discover(options));
  };

  // react-native-web renders a Pressable with an href as an <a>; React Native's types don't list it.
  const anchor = web ? ({ href: routes.discoverUrl(options) } as object) : null;
  const tag = variant === 'tag';
  return (
    <Pressable
      {...anchor}
      {...handlers}
      onPress={onPress}
      hitSlop={tag ? TAG_SLOP : undefined}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        tag ? styles.tag : styles.text,
        (hovered || pressed) && (tag ? styles.tagHover : styles.textHover),
        focusVisible && focusRing,
      ]}
    >
      <Text variant={tag ? 'caption' : 'bodySmall'} style={tag ? styles.tagLabel : styles.textLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "See all" next to a shelf: Discover on just that ranking or tag. */
export function SeeAllLink({ title, options }: { title: string; options: DiscoverOptions }) {
  const { t } = useTranslation();
  return (
    <DiscoverLink
      options={options}
      label={t('common:actions.seeAll')}
      accessibilityLabel={t('home:home.seeAllA11y', { title })}
      variant="text"
    />
  );
}

const styles = StyleSheet.create({
  text: {
    minHeight: layout.minTarget,
    minWidth: layout.minTarget,
    paddingHorizontal: space.sm,
    // The label lines up with the page edge; the hover background reaches past it.
    marginRight: -space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  textHover: { backgroundColor: colors.surfaceAlt },
  textLabel: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
  tag: {
    minHeight: TAG_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceAlt,
  },
  tagHover: { borderColor: colors.inkMuted },
  tagLabel: { fontFamily: fonts.sansMedium },
});
