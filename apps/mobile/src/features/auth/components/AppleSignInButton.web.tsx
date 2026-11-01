import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../components/ui';
import { colors } from '../../../theme/tokens';
import type { AppleSignInButtonProps } from './AppleSignInButton';

const ICON_SIZE = 20;

// Web: a regular button that starts Supabase's Apple OAuth redirect.
export function AppleSignInButton({ onPress, busy = false }: AppleSignInButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      label={t('auth:welcome.apple')}
      onPress={onPress}
      variant="secondary"
      loading={busy}
      fullWidth
      icon={<Ionicons name="logo-apple" size={ICON_SIZE} color={colors.ink} />}
    />
  );
}
