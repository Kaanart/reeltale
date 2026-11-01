import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Skeleton, Text } from '../../../components/ui';
import { space } from '../../../theme/tokens';
import { ErrorText } from '../../auth';
import { ScreenFrame } from '../components/ScreenFrame';
import { Card, Divider, Section } from '../components/Section';
import { useBlockedAccounts, useSetBlocked } from '../hooks';
import { formatDay } from '../logic/dates';
import { errorText } from '../logic/errors';

// The people you have blocked, with a way to undo it. A blocked profile is hidden from the person who blocked
// it, so no profile page can offer "Unblock": this list is the way back. It shows no names (they are hidden
// too), only when each block was made.
export function BlockedAccountsScreen() {
  const { t, i18n } = useTranslation();
  const blocks = useBlockedAccounts();
  const setBlocked = useSetBlocked();
  const rows = blocks.data ?? [];
  const working = setBlocked.isPending ? setBlocked.variables?.target : null;

  return (
    <ScreenFrame title={t('settings:blocked.title')}>
      <Text variant="body" color="inkMuted">
        {t('settings:blocked.intro')}
      </Text>

      <Section>
        {blocks.isLoading ? (
          <View accessibilityLabel={t('common:state.loading')} accessibilityRole="progressbar">
            <Skeleton height={space.xxl * 2} />
          </View>
        ) : null}

        {!blocks.isLoading && blocks.data === undefined && blocks.isError ? (
          <View>
            <ErrorText error={errorText(blocks.error)} />
            <View style={styles.retry}>
              <Button label={t('common:actions.retry')} variant="secondary" onPress={() => void blocks.refetch()} />
            </View>
          </View>
        ) : null}

        {blocks.data !== undefined && rows.length === 0 ? (
          <Card padded>
            <Text variant="body" color="inkMuted" testID="blocked-none">
              {t('settings:blocked.none')}
            </Text>
          </Card>
        ) : null}

        {rows.length > 0 ? (
          <Card>
            {rows.map((row, i) => {
              const date = row.created_at ? formatDay(row.created_at, i18n.language) : '';
              return (
                <View key={row.blocked_id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.row} testID="blocked-row">
                    <View style={styles.text}>
                      <Text variant="body">{t('settings:blocked.account')}</Text>
                      {date ? (
                        <Text variant="bodySmall" color="inkMuted">
                          {t('settings:blocked.since', { date })}
                        </Text>
                      ) : null}
                    </View>
                    <Button
                      label={t('settings:blocked.unblock')}
                      accessibilityLabel={date ? t('settings:blocked.unblockA11y', { date }) : t('settings:blocked.unblock')}
                      variant="secondary"
                      size="sm"
                      onPress={() => setBlocked.mutate({ target: row.blocked_id, blocked: false })}
                      loading={working === row.blocked_id}
                      disabled={setBlocked.isPending}
                      testID="blocked-unblock"
                    />
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}

        <ErrorText error={setBlocked.isError ? errorText(setBlocked.error) : null} />
      </Section>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  retry: { marginTop: space.md, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: space.lg, paddingVertical: space.sm },
  text: { flex: 1, marginRight: space.md },
});
