// Session storage for the native apps, encrypted at rest. Supabase's documented "LargeSecureStore":
// the session JSON is too big for the Keychain / Keystore (expo-secure-store caps values at 2 KB), so
// it is AES-256-CTR encrypted into AsyncStorage, and only the key lives in the secure store. Every write
// uses a fresh random key, so a key and counter are never reused.
//
// Pure: the stores and the random source are passed in (sessionStorage.ts wires up the real ones), so
// node tests it (src/core/__tests__/encryptedStorage.test.ts).

import * as aesjsModule from 'aes-js';

// aes-js is CommonJS without named exports: node puts module.exports on `default`, Metro's interop puts
// it there too (and also copies its keys). Reading `default` first works in both.
const aesjs = (aesjsModule as unknown as { default?: typeof aesjsModule }).default ?? aesjsModule;

export interface StringStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface EncryptedStorageDeps {
  /** Holds the AES keys (expo-secure-store). */
  keys: StringStore;
  /** Holds the ciphertext (AsyncStorage). */
  data: StringStore;
  /** Cryptographically secure random bytes (expo-crypto getRandomBytes). */
  randomBytes: (count: number) => Uint8Array;
}

const KEY_BYTES = 32;
const HEX = /^[0-9a-f]+$/i;

export function createEncryptedStorage({ keys, data, randomBytes }: EncryptedStorageDeps): StringStore {
  const cipher = (key: Uint8Array) => new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(1));

  return {
    async getItem(name) {
      const encrypted = await data.getItem(name);
      if (!encrypted) return null;
      const keyHex = await keys.getItem(name);
      // A missing or damaged key (keychain reset, restore to a new phone): the session is unreadable, so drop it.
      if (!keyHex || keyHex.length !== KEY_BYTES * 2 || !HEX.test(keyHex) || !HEX.test(encrypted) || encrypted.length % 2 !== 0) {
        await data.removeItem(name);
        await keys.removeItem(name);
        return null;
      }
      const bytes = cipher(aesjs.utils.hex.toBytes(keyHex)).decrypt(aesjs.utils.hex.toBytes(encrypted));
      return aesjs.utils.utf8.fromBytes(bytes);
    },

    async setItem(name, value) {
      const key = randomBytes(KEY_BYTES);
      if (key.length !== KEY_BYTES) throw new Error('random source returned the wrong number of bytes');
      const encrypted = cipher(key).encrypt(aesjs.utils.utf8.toBytes(value));
      // Key first: if the second write fails, the old ciphertext no longer decrypts and reads as signed out.
      await keys.setItem(name, aesjs.utils.hex.fromBytes(key));
      await data.setItem(name, aesjs.utils.hex.fromBytes(encrypted));
    },

    async removeItem(name) {
      await data.removeItem(name);
      await keys.removeItem(name);
    },
  };
}
