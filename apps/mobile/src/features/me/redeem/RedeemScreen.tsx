import { Redirect } from 'expo-router';

// The iOS and Android version of the redeem screen: there is none (access codes exist on the web only,
// App Store 3.1.1), so this only sends people Home. RedeemScreen.web.tsx is the real screen.
//
// Expo Router bundles every file under src/app on every platform, `.web.tsx` ones included, and everything
// they import. The route file (app/redeem.web.tsx) therefore imports the screen by this name: iOS and
// Android resolve it to this stub, so the code entry, the Turnstile widget and the redeem call never reach
// the apps. Keep both versions exporting the same thing.
export function RedeemScreen() {
  return <Redirect href="/" />;
}
