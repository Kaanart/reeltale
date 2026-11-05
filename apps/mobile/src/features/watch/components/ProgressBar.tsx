// How far into the episode playback is, and (with `onSeek`) a scrubber: drag the bar or tap it to skip ahead or
// back. The touch area is taller than the 3 px line; while dragging, the line thickens, a thumb follows the
// finger and the time shows above it. The video jumps once, on release. Screen readers get an adjustable control
// that moves 5 seconds a step (logic/scrub.ts). Same component on iOS, Android and the web (PanResponder works on
// all three; on the web, touch-action keeps the page from scrolling under the drag).

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PanResponder, Platform, StyleSheet, View,
  type AccessibilityActionEvent, type LayoutChangeEvent, type ViewStyle,
} from 'react-native';

import { Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';
import { clock, secondsAt, stepSeconds } from '../logic/scrub';

const TRACK = 3;
const TRACK_DRAGGING = 6;
const THUMB = 14;
const HIT_HEIGHT = 28;

// Web only: a pointer cursor, and no browser panning while a finger drags the bar.
const WEB_SCRUBBER = Platform.OS === 'web' ? ({ cursor: 'pointer', touchAction: 'none' } as unknown as ViewStyle) : null;

export interface ProgressBarProps {
  /** Seconds played. */
  position: number;
  /** Seconds in the video. */
  duration: number;
  label: string;
  /** Jump to this second. Without it the bar only shows progress. */
  onSeek?: (seconds: number) => void;
}

export function ProgressBar({ position, duration, label, onSeek }: ProgressBarProps) {
  const { t } = useTranslation();
  const total = Math.max(0, duration);
  const [width, setWidth] = useState(0);
  // The second under the finger while dragging; null otherwise.
  const [dragAt, setDragAt] = useState<number | null>(null);
  const grabX = useRef(0);
  // The responder below is made once; it reads the newest values from here.
  const latest = useRef({ width, total, onSeek });
  latest.current = { width, total, onSeek };

  const pan = useMemo(() => {
    const can = () => !!latest.current.onSeek && latest.current.total > 0 && latest.current.width > 0;
    const at = (x: number) => secondsAt(x, latest.current.width, latest.current.total);
    return PanResponder.create({
      onStartShouldSetPanResponder: can,
      onMoveShouldSetPanResponder: can,
      // Once dragging, the pager's swipe may not take the gesture away.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        grabX.current = e.nativeEvent.locationX;
        setDragAt(at(grabX.current));
      },
      onPanResponderMove: (_e, g) => setDragAt(at(grabX.current + g.dx)),
      onPanResponderRelease: (_e, g) => {
        setDragAt(null);
        latest.current.onSeek?.(at(grabX.current + g.dx));
      },
      onPanResponderTerminate: () => setDragAt(null),
    });
  }, []);

  const shown = Math.min(total, Math.max(0, dragAt ?? position));
  const fraction = total > 0 ? shown / total : 0;
  const dragging = dragAt !== null;
  const timeText = t('watch:scrubberValue', { position: clock(shown), duration: clock(total) });

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (!onSeek) return;
    if (e.nativeEvent.actionName === 'increment') onSeek(stepSeconds(shown, total, 1));
    if (e.nativeEvent.actionName === 'decrement') onSeek(stepSeconds(shown, total, -1));
  };

  const track = (
    <View style={[styles.track, dragging && styles.trackDragging]} pointerEvents="none">
      <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
    </View>
  );

  if (!onSeek) {
    return (
      <View
        style={styles.readOnly}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        aria-valuemin={0}
        aria-valuemax={Math.floor(total)}
        aria-valuenow={Math.floor(shown)}
      >
        {track}
      </View>
    );
  }

  return (
    <View
      style={[styles.hit, WEB_SCRUBBER]}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint={t('watch:scrubberHint')}
      aria-valuemin={0}
      aria-valuemax={Math.floor(total)}
      aria-valuenow={Math.floor(shown)}
      aria-valuetext={timeText}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAccessibilityAction}
      testID="watch-scrubber"
      {...pan.panHandlers}
    >
      {track}
      {dragging ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: fraction * width - THUMB / 2 }]}
          />
          <View pointerEvents="none" style={styles.timeRow}>
            <View style={styles.timePill}>
              <Text variant="caption" color="surface" style={styles.time}>
                {timeText}
              </Text>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  readOnly: { justifyContent: 'center' },
  hit: { height: HIT_HEIGHT, justifyContent: 'center' },
  track: {
    height: TRACK,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
    overflow: 'hidden',
  },
  trackDragging: { height: TRACK_DRAGGING },
  fill: { height: '100%', backgroundColor: colors.surface },
  thumb: {
    position: 'absolute',
    top: (HIT_HEIGHT - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.surface,
  },
  timeRow: { position: 'absolute', left: 0, right: 0, bottom: HIT_HEIGHT - space.xs, alignItems: 'center' },
  timePill: { paddingHorizontal: space.sm, paddingVertical: space.xs / 2, borderRadius: radius.pill, backgroundColor: colors.playerBg },
  time: { fontVariant: ['tabular-nums'] },
});
