// iOS and Android. Sign in with Apple uses the system sheet (expo-apple-authentication, iOS only) and hands
// Apple's ID token to Supabase. The nonce: Apple gets its SHA-256, Supabase the raw value, and Supabase
// checks that they match, so a token can't be replayed into another sign-in.
//
// Not here yet (follow-up): Google on iOS/Android, and Apple on Android, both through the OAuth flow in an
// in-app browser (WebBrowser.openAuthSessionAsync + a reeltale:// redirect). Until then those buttons are hidden.

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { SignInCancelled, SignInUnavailable } from './validation';
import type { SignInProviders } from './providers.types';

function randomNonce(): string {
  return Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const signInProviders: SignInProviders = {
  async appleAvailable() {
    if (Platform.OS !== 'ios') return false;
    try {
      return await AppleAuthentication.isAvailableAsync();
    } catch {
      return false;
    }
  },

  async signInWithApple(client) {
    const rawNonce = randomNonce();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      // Email only: the app never uses the name Apple offers (display names are chosen and moderated in the app).
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
    } catch (err) {
      if ((err as { code?: unknown }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
      throw err;
    }
    if (!credential.identityToken) throw new SignInUnavailable();
    const { error } = await client.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
    if (error) throw error;
  },

  googleAvailable: false,

  async signInWithGoogle() {
    throw new SignInUnavailable();
  },
};
