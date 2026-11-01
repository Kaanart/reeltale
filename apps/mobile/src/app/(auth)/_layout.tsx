import { Stack } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '../../features/auth';
import { useStickyGate } from '../../features/auth/useStickyGate';
import { isAuthGate, type AuthGate } from '../../lib/gate';
import { colors } from '../../theme/tokens';

// The way in: each gate unlocks only its own screens, so a gate change (signed in, birthday answered,
// Terms accepted) moves the user on by itself and they can't go back to a step that is done.
export default function AuthLayout() {
  const { gate } = useAuth();
  const settled = useStickyGate(gate);
  // Once the account is through ('ready'), the root layout swaps to the tabs; until then the last
  // screen stays as it was instead of flashing back to Welcome.
  const [lastAuth, setLastAuth] = useState<AuthGate>('signedOut');
  const shown = settled && isAuthGate(settled) ? settled : lastAuth;
  if (shown !== lastAuth) setLastAuth(shown);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={shown === 'signedOut'}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="email" />
        <Stack.Screen name="code" />
        <Stack.Screen name="password" />
      </Stack.Protected>
      {/* The 18+ gate, the blocked notice and the Terms can't be swiped away. */}
      <Stack.Protected guard={shown === 'age'}>
        <Stack.Screen name="birthday" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={shown === 'blocked'}>
        <Stack.Screen name="blocked" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={shown === 'terms'}>
        <Stack.Screen name="terms" options={{ gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );
}
