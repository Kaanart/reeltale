import { Redirect } from 'expo-router';

// Access codes exist on the web only (App Store 3.1.1): this is the route in the iOS and Android apps, and it
// only sends people Home. The screen itself is redeem.web.tsx, which no native build includes.
export default function RedeemRoute() {
  return <Redirect href="/" />;
}
