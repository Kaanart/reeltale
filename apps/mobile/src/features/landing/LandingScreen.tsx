import { Redirect, type Href } from 'expo-router';

import { useAuth } from '../auth';
import { useStickyGate } from '../auth/useStickyGate';
import { nativeStartPath } from './logic/landing';

// The iOS and Android version of the landing page: there is none. The apps open on their own sign-in
// screen (or the gate step the account is at), so '/' just sends people there. LandingScreen.web.tsx is the
// real page; the route file (app/(auth)/index.tsx) imports this name, so Metro picks the right one per
// platform and the web-only landing strings never reach the apps. Keep both versions exporting the same
// thing.
export function LandingScreen() {
  const { gate } = useAuth();
  const settled = useStickyGate(gate);
  return <Redirect href={nativeStartPath(settled) as Href} />;
}
