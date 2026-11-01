import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createEncryptedStorage, type StringStore } from '../../lib/encryptedStorage.ts';

function memory(): StringStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
  };
}

function setup() {
  const keys = memory();
  const data = memory();
  const storage = createEncryptedStorage({ keys, data, randomBytes: (n) => new Uint8Array(randomBytes(n)) });
  return { keys, data, storage };
}

const SESSION = JSON.stringify({
  access_token: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.sig', refresh_token: 'r3fr3sh', user: { id: 'u1', email: 'zoë@example.com' },
});
const NAME = 'sb-abcdefghijkl-auth-token';

test('round-trips the session, including non-ASCII text', async () => {
  const { storage } = setup();
  await storage.setItem(NAME, SESSION);
  assert.equal(await storage.getItem(NAME), SESSION);
  assert.equal(await storage.getItem('other'), null);
});

test('nothing readable reaches AsyncStorage, and the key sits in the secure store only', async () => {
  const { keys, data, storage } = setup();
  await storage.setItem(NAME, SESSION);
  const stored = data.map.get(NAME) ?? '';
  assert.match(stored, /^[0-9a-f]+$/);
  for (const secret of ['r3fr3sh', 'access_token', 'example.com']) {
    assert.ok(!stored.includes(Buffer.from(secret).toString('hex')), `ciphertext leaks ${secret}`);
    assert.ok(!stored.includes(secret));
  }
  const key = keys.map.get(NAME) ?? '';
  assert.match(key, /^[0-9a-f]{64}$/, 'a 256-bit key');
  assert.ok(!data.map.has(`${NAME}-key`) && ![...data.map.values()].includes(key), 'the key never goes to AsyncStorage');
  // Small enough for expo-secure-store (2 KB per value).
  assert.ok(key.length < 2048);
});

test('every write uses a fresh key', async () => {
  const { keys, data, storage } = setup();
  await storage.setItem(NAME, SESSION);
  const first = { key: keys.map.get(NAME), data: data.map.get(NAME) };
  await storage.setItem(NAME, SESSION);
  assert.notEqual(keys.map.get(NAME), first.key);
  assert.notEqual(data.map.get(NAME), first.data, 'same text, different ciphertext');
  assert.equal(await storage.getItem(NAME), SESSION);
});

test('a missing or damaged key reads as signed out and clears both stores', async () => {
  for (const damage of [
    (keys: Map<string, string>) => keys.delete(NAME),
    (keys: Map<string, string>) => keys.set(NAME, 'zz'),
    (keys: Map<string, string>) => keys.set(NAME, 'ab'.repeat(16)),
  ]) {
    const { keys, data, storage } = setup();
    await storage.setItem(NAME, SESSION);
    damage(keys.map);
    assert.equal(await storage.getItem(NAME), null);
    assert.equal(data.map.has(NAME), false);
    assert.equal(keys.map.has(NAME), false);
  }
});

test('removeItem clears the ciphertext and the key', async () => {
  const { keys, data, storage } = setup();
  await storage.setItem(NAME, SESSION);
  await storage.removeItem(NAME);
  assert.equal(data.map.size, 0);
  assert.equal(keys.map.size, 0);
  assert.equal(await storage.getItem(NAME), null);
});

test('a broken random source is refused instead of writing with a short key', async () => {
  const storage = createEncryptedStorage({ keys: memory(), data: memory(), randomBytes: () => new Uint8Array(8) });
  await assert.rejects(storage.setItem(NAME, SESSION));
});
