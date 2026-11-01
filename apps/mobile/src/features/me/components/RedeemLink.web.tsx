import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Card } from './Section';
import { NavRow } from './Rows';

// Web only: from the wallet to the redeem screen.
export function RedeemLink() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card>
      <NavRow label={t('redeem:title')} onPress={() => router.push('/redeem')} testID="wallet-redeem" />
    </Card>
  );
}
