// Where supabase-js keeps the session on iOS and Android: AES-encrypted in AsyncStorage, key in the
// Keychain / Android Keystore (expo-secure-store). The web uses supabase-js's default (localStorage):
// see sessionStorage.web.ts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createEncryptedStorage, type StringStore } from './encryptedStorage';

const keychain: StringStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  // Readable after the first unlock (the app can be woken in the background); never synced to other devices.
  setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const nativeSessionStorage: StringStore | undefined = createEncryptedStorage({
  keys: keychain,
  data: AsyncStorage,
  randomBytes: getRandomBytes,
});
