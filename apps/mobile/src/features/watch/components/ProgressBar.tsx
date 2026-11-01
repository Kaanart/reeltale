import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../../../theme/tokens';

const HEIGHT = 3;

// How far into the episode playback is. Read-only: episodes are short, and a swipe is the main gesture.
export function ProgressBar({ position, duration, label }: { position: number; duration: number; label: string }) {
  const total = Math.max(0, Math.round(duration));
  const now = Math.min(total, Math.max(0, Math.round(position)));
  const fraction = total > 0 ? now / total : 0;
  return (
    <View
      style={styles.track}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now }}
    >
      <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
    overflow: 'hidden',
  },
  fill: { height: HEIGHT, backgroundColor: colors.surface },
});
