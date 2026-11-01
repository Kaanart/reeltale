import { Pressable, StyleSheet, View } from 'react-native';

import { AIBadge, Text } from '../../../components/ui';
import { fonts, space } from '../../../theme/tokens';
import { isAiSeries, type SeriesCard } from '../logic';
import { Cover, COVER_RATIO } from './Cover';
import { MaturityMarker } from './MaturityMarker';
import { useSeriesText } from './useSeriesText';

const TITLE_LINES = 2;
const TITLE_LINE_HEIGHT = 20;
const META_LINE_HEIGHT = 16;
/** Everything under the cover: gap, two title lines, one meta line. Fixed, so a row of tiles has one height. */
export const TILE_TEXT_HEIGHT = space.sm + TITLE_LINES * TITLE_LINE_HEIGHT + space.xs + META_LINE_HEIGHT;

export function tileHeight(width: number): number {
  return Math.ceil(width / COVER_RATIO) + TILE_TEXT_HEIGHT;
}

export interface SeriesTileProps {
  series: SeriesCard;
  width: number;
  onPress: (series: SeriesCard) => void;
}

/** A cover with the title and format under it. AI series always carry the AI label on the cover. */
export function SeriesTile({ series, width, onPress }: SeriesTileProps) {
  const text = useSeriesText()(series);
  return (
    <Pressable
      onPress={() => onPress(series)}
      accessibilityRole="button"
      accessibilityLabel={text.a11y}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <Cover series={series} width={width}>
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
        <Text variant="bodySmall" numberOfLines={TITLE_LINES} style={styles.title}>
          {series.title}
        </Text>
        <Text variant="caption" color="inkMuted" numberOfLines={1} style={styles.meta}>
          {text.meta}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  topLeft: { position: 'absolute', top: space.sm, left: space.sm },
  bottomLeft: { position: 'absolute', bottom: space.sm, left: space.sm },
  text: { height: TILE_TEXT_HEIGHT, paddingTop: space.sm },
  title: { fontFamily: fonts.sansMedium, lineHeight: TITLE_LINE_HEIGHT },
  meta: { marginTop: space.xs, lineHeight: META_LINE_HEIGHT },
});
