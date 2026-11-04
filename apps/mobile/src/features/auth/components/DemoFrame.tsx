import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../../../components/ui';
import { isDemoSession, leaveWebDemo } from '../../../lib/env';
import { colors, fonts, space } from '../../../theme/tokens';

// Demo mode only: a slim "Demo" ribbon across the top of every screen, so nobody mistakes fixtures for
// real data. The app sits below it: the ribbon takes the top safe area, and the screens underneath see a
// top inset of 0 (useSafeAreaInsets and the native SafeAreaView both measure from where they are).
export function DemoFrame({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  if (!enabled) return <>{children}</>;

  return (
    <View style={styles.fill}>
      <View
        style={[styles.ribbon, { paddingTop: insets.top + RIBBON_PAD }]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('common:demo.a11y')}
      >
        <Text variant="caption" style={styles.label}>
          {t('common:demo.badge')}
        </Text>
      </View>
      {isDemoSession ? (
        // The live website's demo (chosen with "Explore the demo"): one click back to the real site.
        <Pressable role="link" accessibilityLabel={t('common:demo.leave')} onPress={leaveWebDemo} style={styles.leave}>
          <Text variant="caption" style={styles.leaveText}>
            {t('common:demo.leave')}
          </Text>
        </Pressable>
      ) : null}
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.fill}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const RIBBON_PAD = 2;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  ribbon: {
    alignItems: 'center',
    paddingBottom: RIBBON_PAD,
    paddingHorizontal: space.lg,
    backgroundColor: colors.warn,
  },
  label: { fontFamily: fonts.sansBold, color: colors.ink },
  leave: { alignItems: 'center', paddingVertical: space.xs, backgroundColor: colors.warn },
  leaveText: { color: colors.ink, textDecorationLine: 'underline' },
});
