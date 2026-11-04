// Root layout: providers, fonts, and the gate. Nothing in the app shows before the account is through the
// 18+ gate and has accepted the Terms (lib/gate.ts):
//   signed out -> (auth)/welcome, no date of birth -> (auth)/birthday, under 18 -> (auth)/blocked,
//   Terms not accepted -> (auth)/terms, otherwise (tabs) and every feature route.
// (auth) and (tabs) are switched with Stack.Protected. Feature routes added later (series/[id], watch/…)
// need no entry here: they are guarded by the redirect below, which sends anyone not through the gate
// to the right (auth) screen. On the web, the few public pages (lib/gate.ts PUBLIC_WEB_PATHS) are open to
// everyone, and SiteShell (components/layout) adds the top bar and the browser tab title.

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Literata_400Regular } from '@expo-google-fonts/literata/400Regular';
import { Literata_700Bold } from '@expo-google-fonts/literata/700Bold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { SiteShell } from '../components/layout';
import { AuthProvider, useAuth } from '../features/auth';
import { DemoFrame } from '../features/auth/components/DemoFrame';
import { AccountErrorOverlay, LoadingOverlay } from '../features/auth/components/GateOverlays';
import { useStickyGate } from '../features/auth/useStickyGate';
import { isDemo } from '../lib/env';
import { redirectFor } from '../lib/gate';
import i18n from '../lib/i18n';
import { queryClient } from '../lib/query';
import { colors, fonts } from '../theme/tokens';

// Keep the native splash up until fonts and the account are known (no flash of the wrong screen).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  // Keys match the family names in theme/tokens.ts.
  const [fontsLoaded, fontError] = useFonts({
    [fonts.serif]: Literata_400Regular,
    [fonts.serifBold]: Literata_700Bold,
    [fonts.sans]: Inter_400Regular,
    [fonts.sansMedium]: Inter_500Medium,
    [fonts.sansBold]: Inter_700Bold,
  });

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <StatusBar style="dark" />
              <DemoFrame enabled={isDemo}>
                <RootNavigator fontsReady={fontsLoaded || !!fontError} />
              </DemoFrame>
            </AuthProvider>
          </QueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { gate } = useAuth();
  const settled = useStickyGate(gate);
  const booted = fontsReady && settled !== null;

  useEffect(() => {
    if (booted) void SplashScreen.hideAsync().catch(() => undefined);
  }, [booted]);

  // First start: render no navigator until the gate is known, so a deep link (on the web, a typed URL)
  // opens where it points instead of being bounced through Welcome.
  if (!booted) return <View style={styles.boot} />;

  const ready = settled === 'ready';
  return (
    <>
      <SiteShell gate={settled}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={!ready}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={ready}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
      </SiteShell>
      <FeatureRouteGuard />
      {gate === 'loading' ? <LoadingOverlay /> : null}
      {gate === 'error' ? <AccountErrorOverlay /> : null}
    </>
  );
}

/** Sends anyone not through the gate away from feature routes the Stack doesn't list (lib/gate.ts redirectFor). */
function FeatureRouteGuard() {
  const { gate } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const target = redirectFor(gate, segments, { web: Platform.OS === 'web' });

  useEffect(() => {
    if (target) router.replace(target as Href);
  }, [target, router]);

  // Cover the screen until the redirect lands, so nothing behind the gate shows even for a frame.
  return target ? <View style={[StyleSheet.absoluteFill, styles.boot]} /> : null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  boot: { flex: 1, backgroundColor: colors.bg },
});
