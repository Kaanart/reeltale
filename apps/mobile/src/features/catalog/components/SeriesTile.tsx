import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { focusRing } from '../../../components/layout';
import { AIBadge, Text } from '../../../components/ui';
import { fonts, motion, radius, space } from '../../../theme/tokens';
import { isAiSeries, type SeriesCard } from '../logic';
import { routes } from '../routes';
import { CardLink } from './CardLink';
import { Cover, COVER_RATIO } from './Cover';
import { MaturityMarker } from './MaturityMarker';
import { useSeriesText } from './useSeriesText';

const TITLE_LINES = 2;
const TITLE_LINE_HEIGHT = 20;
const META_LINE_HEIGHT = 16;
/** Everything under the cover: gap, two title lines, one meta line. Fixed, so a row of tiles has one height. */
export const TILE_TEXT_HEIGHT = space.sm + TITLE_LINES * TITLE_LINE_HEIGHT + space.xs + META_LINE_HEIGHT;
/** How far a cover rises under the mouse (web). Rows of tiles leave this much room above them. */
export const TILE_LIFT = space.xs;

export function tileHeight(width: number): number {
  return Math.ceil(width / COVER_RATIO) + TILE_TEXT_HEIGHT;
}

export interface SeriesTileProps {
  series: SeriesCard;
  width: number;
}

// Web only: the lift eases in and out (transition* are CSS properties React Native's style types don't list).
const LIFT_TRANSITION = (Platform.OS === 'web'
  ? { transitionProperty: 'transform', transitionDuration: `${motion.fast}ms`, transitionTimingFunction: 'ease-out' }
  : {}) as unknown as ViewStyle;

/**
 * A cover with the title and format under it; opens the series page (a real link on the web). AI series
 * always carry the AI label on the cover. Under the mouse the cover rises a little and the title is
 * underlined; the keyboard focus gets a ring.
 */
export function SeriesTile({ series, width }: SeriesTileProps) {
  const text = useSeriesText()(series);
  return (
    <CardLink
      href={routes.series(series.slug)}
      accessibilityLabel={text.a11y}
      cardStyle={(s) => [styles.tile, { width }, s.pressed && styles.pressed, s.focusVisible && focusRing]}
      render={(s) => (
        <>
          <Cover series={series} width={width} style={[LIFT_TRANSITION, s.hovered && styles.lifted]}>
            {isAiSeries(series) ? (
              <View style={styles.topLeft}>
                <AIBadge size="sm" />
              </View>
            ) : null}
            {series.maturity === 'mature' ? (
              <View style={styles.bottomLeft}>
                <MaturityMarker />
              </View>
            ) : null}
          </Cover>
          <View style={styles.text}>
            <Text variant="bodySmall" numberOfLines={TITLE_LINES} style={[styles.title, s.hovered && styles.titleHover]}>
              {series.title}
            </Text>
            <Text variant="caption" color="inkMuted" numberOfLines={1} style={styles.meta}>
              {text.meta}
            </Text>
          </View>
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.card },
  pressed: { opacity: 0.7 },
  lifted: { transform: [{ translateY: -TILE_LIFT }] },
  topLeft: { position: 'absolute', top: space.sm, left: space.sm },
  bottomLeft: { position: 'absolute', bottom: space.sm, left: space.sm },
  text: { height: TILE_TEXT_HEIGHT, paddingTop: space.sm },
  title: { fontFamily: fonts.sansMedium, lineHeight: TITLE_LINE_HEIGHT },
  titleHover: { textDecorationLine: 'underline' },
  meta: { marginTop: space.xs, lineHeight: META_LINE_HEIGHT },
});
