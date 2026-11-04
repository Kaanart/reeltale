import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import type { ChoiceId } from '../../../core/api';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { choiceTakeable, type ChoiceView } from '../logic';

// The three choices at the end of a scene. Each says what tapping it does before it is tapped: open a
// scene already made (free), wait for one being made, cost coins for a new one, or (calmly) that this
// path can't be drawn. On the web each card has a hover state and the keyboard focus ring.
export interface ChoiceListProps {
  choices: readonly ChoiceView[];
  /** The choice being sent. */
  pending: ChoiceId | null;
  /** True while new scenes can't be asked for (no AI consent yet): only scenes already made open. */
  newDisabled: boolean;
  onChoose: (choice: ChoiceView) => void;
}

const MIN_HEIGHT = 64;
const LETTER = 28;
const ICON = 16;

export function ChoiceList({ choices, pending, newDisabled, onChoose }: ChoiceListProps) {
  const { t } = useTranslation();

  const meta = (c: ChoiceView): string => {
    switch (c.state) {
      case 'ready': return t('story:choices.ready');
      case 'working': return t('story:choices.inProgress');
      case 'blocked': return t('story:choices.blockedPath');
      case 'failed': return t('story:scene.retryCost', { count: c.cost });
      default: return t('story:choices.choiceCost', { count: c.cost });
    }
  };

  return (
    <View style={styles.list} testID="story-choices">
      <Text variant="heading" accessibilityRole="header" style={styles.title}>
        {t('story:choices.title')}
      </Text>
      {choices.map((c) => (
        <ChoiceCard
          key={c.id}
          choice={c}
          info={meta(c)}
          disabled={pending !== null || !choiceTakeable(c, newDisabled)}
          busy={pending === c.id}
          onPress={() => onChoose(c)}
        />
      ))}
    </View>
  );
}

interface ChoiceCardProps {
  choice: ChoiceView;
  /** What taking it does: ready, being made, its cost, or that the path can't be drawn. */
  info: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}

function ChoiceCard({ choice: c, info, disabled, busy, onPress }: ChoiceCardProps) {
  const { hovered, focusVisible, handlers } = useInteraction();
  const costs = c.state === 'new' || c.state === 'failed';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={[c.label, c.hint, info].filter((s) => s.trim() !== '').join('. ')}
      accessibilityState={{ disabled, busy }}
      {...handlers}
      style={({ pressed }) => [
        styles.card,
        c.state === 'blocked' && styles.blocked,
        hovered && !disabled && styles.hovered,
        pressed && !disabled && styles.pressed,
        disabled && c.state !== 'blocked' && !busy && styles.dim,
        focusVisible && focusRing,
      ]}
      testID={`story-choice-${c.id}`}
    >
      <View style={[styles.letter, c.state === 'blocked' && styles.letterBlocked]}>
        <Text variant="bodySmall" color={c.state === 'blocked' ? 'inkMuted' : 'surface'} style={styles.letterText}>
          {c.id.toUpperCase()}
        </Text>
      </View>
      <View style={styles.texts}>
        <Text variant="subheading" color={c.state === 'blocked' ? 'inkMuted' : 'ink'}>
          {c.label}
        </Text>
        {c.hint.trim() !== '' ? (
          <Text variant="bodySmall" color="inkMuted">
            {c.hint}
          </Text>
        ) : null}
        <View style={styles.meta}>
          {costs ? <View style={styles.coin} /> : null}
          {c.state === 'ready' ? <Ionicons name="checkmark-circle" size={ICON} color={colors.success} style={styles.metaIcon} /> : null}
          {c.state === 'blocked' ? <Ionicons name="shield-checkmark-outline" size={ICON} color={colors.inkMuted} style={styles.metaIcon} /> : null}
          <Text variant="caption" color={c.state === 'blocked' ? 'inkMuted' : 'ink'} style={styles.metaText}>
            {info}
          </Text>
        </View>
      </View>
      {busy ? <ActivityIndicator color={colors.ink} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  title: { marginBottom: space.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_HEIGHT,
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  blocked: { backgroundColor: colors.surfaceAlt, borderStyle: 'dashed' },
  hovered: { borderColor: colors.ink },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.5 },
  letter: {
    width: LETTER,
    height: LETTER,
    borderRadius: LETTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  letterBlocked: { backgroundColor: colors.line },
  letterText: { fontFamily: fonts.sansBold },
  texts: { flex: 1, gap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  metaIcon: { marginRight: space.xs },
  metaText: { flexShrink: 1, fontFamily: fonts.sansMedium },
  coin: {
    width: space.md,
    height: space.md,
    borderRadius: space.md / 2,
    marginRight: space.xs,
    backgroundColor: colors.coin,
    borderWidth: 1.5,
    borderColor: colors.warn,
  },
});
