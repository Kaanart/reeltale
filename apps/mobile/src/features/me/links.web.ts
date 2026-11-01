// The web version of links.ts (same exports). expo-web-browser's web build opens a small popup window with
// no toolbar or menu bar; a legal page reads better as an ordinary tab, so the web opens one with Linking
// (react-native-web: a new tab, with `noopener`). Only the fixed addresses of logic/legal.ts and
// logic/subscription.ts are ever opened.

import { Linking } from 'react-native';
import { legalUrl, type LegalPageSlug } from './logic/legal';
import { manageSubscriptionUrl, type SubscriptionStore } from './logic/subscription';

async function openInNewTab(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // The browser refused to open it: nothing to show.
  }
}

export async function openLegalPage(slug: LegalPageSlug): Promise<void> {
  await openInNewTab(legalUrl(slug));
}

/** The store's own subscription page, where the user cancels. */
export async function openStoreSubscriptions(store: SubscriptionStore): Promise<void> {
  const url = manageSubscriptionUrl(store);
  if (url) await openInNewTab(url);
}
