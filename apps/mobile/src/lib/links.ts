// Legal pages (hosted on the studio site, generated from prep/legal) and how to open them: in an in-app
// browser sheet on iOS and Android, in a new tab on the web.

import * as WebBrowser from 'expo-web-browser';

export const LEGAL_URLS = {
  terms: 'https://eurastudios.com/apps/reeltale/terms/',
  privacy: 'https://eurastudios.com/apps/reeltale/privacy/',
} as const;

export type LegalPage = keyof typeof LEGAL_URLS;

export async function openLegal(page: LegalPage): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(LEGAL_URLS[page]);
  } catch {
    // Nothing to show: the page simply didn't open (no browser available).
  }
}
