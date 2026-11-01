import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { space } from '../../../theme/tokens';
import { ErrorText, useUserId } from '../../auth';
import { useIsBlocked, useSetBlocked } from '../hooks';
import { blockErrorText } from '../logic/errors';

// Block or unblock one account (public.block_user / unblock_user). For profile screens and the "..." menus of
// series pages: pass the id of the person. It shows nothing for the signed-in person's own id.
export function BlockButton({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const selfId = useUserId();
  const blocked = useIsBlocked(userId);
  const mutation = useSetBlocked();

  if (!userId || userId === selfId) return null;
  const isBlocked = blocked.data === true;

  return (
    <View>
      {isBlocked ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.note}>
          {t('profile:user.blockedNote')}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button
          label={t(isBlocked ? 'profile:user.unblock' : 'profile:user.block')}
          variant="secondary"
          onPress={() => mutation.mutate({ target: userId, blocked: !isBlocked })}
          loading={mutation.isPending}
          disabled={blocked.isLoading}
          testID="block-toggle"
        />
      </View>
      <ErrorText error={mutation.isError ? blockErrorText(mutation.error) : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  note: { marginBottom: space.sm },
  row: { alignItems: 'flex-start' },
});
