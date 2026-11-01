import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';
import { ErrorText } from '../../auth';
import type { FailureAction, SceneView } from '../logic';

// A scene that couldn't be made: a calm message that always says the coins came back (ai:failure.*,
// never the reason a scene was blocked), and what the reader can do next.
export interface SceneFailureProps {
  view: SceneView;
  /** Coins a retry costs (a failed scene is charged again; the first charge was refunded). */
  retryPrice: number;
  onAction: (action: FailureAction) => void;
  busy?: boolean;
  error?: { key: string; params: { count?: number } } | null;
}

const ICON = 32;

export function SceneFailure({ view, retryPrice, onAction, busy = false, error = null }: SceneFailureProps) {
  const { t } = useTranslation();
  const label = (action: FailureAction) => {
    if (action === 'retry') return t('story:scene.retryCost', { count: retryPrice });
    return t(action === 'edit' ? 'ai:failureActions.edit' : 'ai:failureActions.tryAnother');
  };

  return (
    <View style={styles.card} testID="story-failure">
      <Ionicons name={view.phase === 'blocked' ? 'shield-checkmark-outline' : 'refresh-circle-outline'} size={ICON} color={colors.inkMuted} />
      <Text variant="subheading" accessibilityRole="header" style={styles.title}>
        {t(view.phase === 'blocked' ? 'ai:progress.blocked' : 'ai:progress.failed')}
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        {t(view.failureKey ?? 'ai:failure.failed')}
      </Text>
      <View style={styles.actions}>
        {view.actions.map((action, i) => (
          <Button
            key={action}
            label={label(action)}
            onPress={() => onAction(action)}
            variant={i === 0 ? 'primary' : 'secondary'}
            loading={busy && action === 'retry'}
            disabled={busy}
            fullWidth
            testID={`story-failure-${action}`}
          />
        ))}
      </View>
      <ErrorText error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  title: { marginTop: space.sm },
  body: { marginTop: space.sm },
  actions: { marginTop: space.lg, gap: space.sm },
});
