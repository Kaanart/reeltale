import type { StoryManifest } from '@reeltale/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { orderedPanels, type RevealStep } from '../../../core/comic';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { visibleText } from '../logic';

// The words of the scene so far, beside the stage on a wide window: each panel's caption and dialogue, as far as
// the scene clock has shown them (nothing ahead is spoiled). The current panel is marked; pressing a panel jumps
// the stage to it. Once the scene has played (or the reader has chosen from it before), every panel is listed.

export interface SceneTranscriptProps {
  manifest: StoryManifest;
  steps: readonly RevealStep[];
  positionMs: number;
  /** Index of the panel on the stage. */
  current: number;
  /** List every panel in full. */
  showAll: boolean;
  onSeek: (index: number) => void;
}

export function SceneTranscript({ manifest, steps, positionMs, current, showAll, onSeek }: SceneTranscriptProps) {
  const { t } = useTranslation();
  const panels = orderedPanels(manifest);
  const shown = showAll ? panels : panels.slice(0, current + 1);

  return (
    <View style={styles.root} testID="story-transcript">
      <Text variant="caption" color="inkMuted" accessibilityRole="header" style={styles.heading}>
        {t('story:player.transcript')}
      </Text>
      {shown.map((panel, i) => {
        const full = showAll || i < current;
        const visible = full ? { caption: true, lines: panel.dialogue.map((_, n) => n) } : visibleText(steps, panel.n, positionMs);
        return (
          <TranscriptPanel
            key={panel.n}
            number={i + 1}
            active={i === current}
            caption={visible.caption ? panel.caption : ''}
            lines={visible.lines.map((n) => panel.dialogue[n]).filter((d): d is NonNullable<typeof d> => !!d && d.line.trim() !== '')}
            label={t('story:player.goToPanel', { number: i + 1 })}
            title={t('story:player.transcriptPanel', { number: i + 1 })}
            onPress={() => onSeek(i)}
          />
        );
      })}
    </View>
  );
}

interface TranscriptPanelProps {
  number: number;
  active: boolean;
  caption: string;
  lines: readonly { name: string; line: string }[];
  label: string;
  title: string;
  onPress: () => void;
}

function TranscriptPanel({ number, active, caption, lines, label, title, onPress }: TranscriptPanelProps) {
  const { t } = useTranslation();
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      {...handlers}
      style={({ pressed }) => [
        styles.panel,
        active && styles.active,
        (hovered || pressed) && !active && styles.hover,
        focusVisible && focusRing,
      ]}
      testID={`story-transcript-${number}`}
    >
      <Text variant="caption" color={active ? 'ink' : 'inkMuted'} style={styles.panelTitle}>
        {title}
      </Text>
      {caption.trim() !== '' ? (
        <Text variant="bodySmall" style={styles.caption}>
          {caption}
        </Text>
      ) : null}
      {lines.map((d, i) => (
        <Text key={i} variant="bodySmall" style={styles.line}>
          {d.name.trim() !== '' ? t('story:player.speakerLine', { name: d.name, line: d.line }) : d.line}
        </Text>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xs },
  heading: { fontFamily: fonts.sansMedium, marginBottom: space.xs },
  panel: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.chip,
    borderLeftWidth: space.xs,
    borderLeftColor: colors.line,
  },
  active: { borderLeftColor: colors.accent, backgroundColor: colors.surface },
  hover: { backgroundColor: colors.surfaceAlt },
  panelTitle: { fontFamily: fonts.sansMedium, marginBottom: space.xs / 2 },
  caption: { fontFamily: fonts.serif },
  line: { marginTop: space.xs / 2 },
});
