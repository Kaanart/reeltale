import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, motion, radius as radiusToken, space } from '../../theme/tokens';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
}

const FADE_MS = motion.slow * 3;
const DIM_OPACITY = 0.5;

export function Skeleton({ width = '100%', height = space.lg, radius = radiusToken.chip }: SkeletonProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!reducedMotion) {
      // Fades 1 -> 0.5 and back, forever.
      opacity.value = withRepeat(
        withTiming(DIM_OPACITY, { duration: FADE_MS, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }
    return () => {
      cancelAnimation(opacity);
      opacity.value = 1;
    };
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const shape = { width, height, borderRadius: radius };

  // Decorative: the screen that shows a skeleton announces its own loading state.
  if (reducedMotion) {
    return <View style={[styles.block, shape]} accessible={false} importantForAccessibility="no" />;
  }

  return (
    <Animated.View
      style={[styles.block, shape, animatedStyle]}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.line },
});
