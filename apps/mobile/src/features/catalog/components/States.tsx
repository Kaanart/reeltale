import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { space } from '../../../theme/tokens';

/** A load that failed: what went wrong in plain words (never the server's text) and, when it can help, Try again. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const info = describeError(error);
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Text align="center" color="inkMuted">
        {t(info.key, info.params)}
      </Text>
      {info.retryable || info.action === 'retry' ? (
        <Button label={t('common:actions.retry')} variant="secondary" size="sm" onPress={onRetry} />
      ) : null}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.box}>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {body ? (
        <Text align="center" color="inkMuted">
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" size="sm" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.xxl },
});
