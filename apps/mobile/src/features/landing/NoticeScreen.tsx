import { Redirect } from 'expo-router';

// The iOS and Android version of /notice: there is none. In the apps, people report content with the
// Report button next to it (features/me report modal, public.report_content). The public notice form for
// everyone, signed in or not, is the website's (NoticeScreen.web.tsx), so the Turnstile widget and the
// web-only strings never reach the apps. Keep both versions exporting the same thing.
export function NoticeScreen() {
  return <Redirect href="/" />;
}
