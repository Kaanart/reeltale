import { Redirect } from 'expo-router';

// The iOS and Android version of /about: there is none (the public pages exist on the website only, and
// their strings are web-only: lib/i18n.ts). The apps carry the same facts in Settings (legal links,
// imprint). AboutScreen.web.tsx is the real page. Keep both versions exporting the same thing.
export function AboutScreen() {
  return <Redirect href="/" />;
}
