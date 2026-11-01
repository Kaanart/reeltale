import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';

// The frame every sign-in screen shares: optional back button, title, hint, content, and a footer that
// sits at the bottom (and moves up with the keyboard).
export interface AuthScreenProps {
  title?: string;
  hint?: string;
  /** Show a back button (to the previous screen, or Welcome when there is none). */
  back?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}

const MAX_WIDTH = 480;
const BACK_SIZE = 44;

export function AuthScreen({ title, hint, back = false, children, footer }: AuthScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/welcome');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.column}>
            {back ? (
              <Pressable
                onPress={goBack}
                accessibilityRole="button"
                accessibilityLabel={t('common:actions.back')}
                hitSlop={space.xs}
                style={({ pressed }) => [styles.back, pressed && styles.pressed]}
              >
                <Ionicons name="chevron-back" size={space.xl} color={colors.ink} />
              </Pressable>
            ) : null}
            {title ? (
              <Text variant="title" accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            ) : null}
            {hint ? (
              <Text variant="body" color="inkMuted" style={styles.hint}>
                {hint}
              </Text>
            ) : null}
            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl, paddingVertical: space.lg },
  column: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    marginLeft: -space.md,
    marginBottom: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  title: { marginBottom: space.sm },
  hint: { marginBottom: space.xl },
  body: { flexGrow: 1 },
  footer: { marginTop: space.xl },
});
