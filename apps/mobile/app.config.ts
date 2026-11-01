// Expo app config (SDK 57). Identifiers match the store records and the Worker's association files
// (apple-app-site-association, assetlinks.json). Public runtime config comes from EXPO_PUBLIC_* variables
// (EAS env for builds, a local .env for development); secrets never go here.
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'ReelTale',
  slug: 'reeltale',
  scheme: 'reeltale',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  runtimeVersion: { policy: 'fingerprint' },
  ios: {
    bundleIdentifier: 'com.euragnos.reeltale',
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: ['applinks:reeltale.net'],
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'com.euragnos.reeltale',
    // The system photo picker needs no media permissions (Play policy on READ_MEDIA_*).
    blockedPermissions: ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_EXTERNAL_STORAGE'],
    intentFilters: [{
      action: 'VIEW',
      autoVerify: true,
      data: [{ scheme: 'https', host: 'reeltale.net', pathPrefix: '/series' }, { scheme: 'https', host: 'reeltale.net', pathPrefix: '/s' }],
      category: ['BROWSABLE', 'DEFAULT'],
    }],
  },
  web: {
    bundler: 'metro',
    // One HTML shell: the Worker serves it for every path (single-page app fallback) and injects share tags.
    output: 'single',
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    'expo-apple-authentication',
    'expo-video',
    ['expo-audio', { microphonePermission: 'ReelTale uses the microphone only while you say your story choice out loud.' }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
