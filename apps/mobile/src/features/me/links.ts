// Opening things outside the app. Legal pages open in an in-app browser sheet on iOS and Android (links.web.ts
// opens a new tab on the web). Only the fixed addresses of logic/legal.ts and logic/subscription.ts are ever opened.

import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { legalUrl, type LegalPageSlug } from './logic/legal';
import { manageSubscriptionUrl, type SubscriptionStore } from './logic/subscription';

export async function openLegalPage(slug: LegalPageSlug): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(legalUrl(slug));
  } catch {
    // The page simply didn't open (no browser available): nothing to show.
  }
}

/** The store's own subscription page, where the user cancels. */
export async function openStoreSubscriptions(store: SubscriptionStore): Promise<void> {
  const url = manageSubscriptionUrl(store);
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    // No store app to open it: nothing to show.
  }
}
