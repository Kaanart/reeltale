import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';

// The frame the Me screens share: a header (back or close button and the title), a scrolling body that stays
// readable on a wide web page, and an optional footer pinned under it. The header is our own, not the
// navigator's, so it looks the same on iOS, Android and the web.
export interface ScreenFrameProps {
  /** Shown in the header. Leave it out when the content brings its own heading (the Me tab). */
  title?: string;
  /** 'back' goes back (or Home when there is nowhere to go back to), 'close' is for modals, 'none' for tabs. */
  leading?: 'back' | 'close' | 'none';
  refreshing?: boolean;
  /** Turns on pull-to-refresh in the apps. */
  onRefresh?: () => void;
  /** A tab screen: the tab bar already covers the bottom edge. */
  tab?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

const MAX_WIDTH = 560;
const BUTTON = 44;

export function ScreenFrame({ title, leading = 'back', refreshing = false, onRefresh, tab = false, children, footer }: ScreenFrameProps) {
  const { t } = useTranslation();
  const router = useRouter();

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe} edges={tab ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {leading !== 'none' || title ? (
          <View style={styles.header}>
            {leading !== 'none' ? (
              <Pressable
                onPress={leave}
                accessibilityRole="button"
                accessibilityLabel={t(leading === 'close' ? 'common:actions.close' : 'common:actions.back')}
                hitSlop={space.xs}
                style={({ pressed }) => [styles.leading, pressed && styles.pressed]}
              >
                <Ionicons name={leading === 'close' ? 'close' : 'chevron-back'} size={space.xl} color={colors.ink} />
              </Pressable>
            ) : null}
            {title ? (
              <Text variant="heading" accessibilityRole="header" numberOfLines={2} style={styles.title}>
                {title}
              </Text>
            ) : null}
          </View>
        ) : null}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} /> : undefined}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
        {footer ? <View style={styles.footer}><View style={styles.column}>{footer}</View></View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    minHeight: BUTTON,
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
  },
  leading: { width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  title: { flex: 1, marginLeft: space.xs },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxl },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  footer: { paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.bg },
});
