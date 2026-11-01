import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_API_URL, isPublishableKey, isUsableApiUrl, resolveApiUrl, resolveConfig } from '../../lib/config.ts';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`;

const URL_OK = 'https://abcdefghijkl.supabase.co';
const PUBLISHABLE = 'sb_publishable_AbC123_xyz-9';
const ios = { os: 'ios' };

test('a configured project with a publishable key runs live', () => {
  const c = resolveConfig({ supabaseUrl: URL_OK, supabaseKey: PUBLISHABLE }, ios);
  assert.deepEqual(c, { supabaseUrl: URL_OK, supabaseKey: PUBLISHABLE, apiUrl: DEFAULT_API_URL, demo: false, demoReason: null });
});

test('EXPO_PUBLIC_DEMO=1 forces demo mode and drops the Supabase values', () => {
  const c = resolveConfig({ supabaseUrl: URL_OK, supabaseKey: PUBLISHABLE, demo: '1' }, ios);
  assert.equal(c.demo, true);
  assert.equal(c.demoReason, 'flag');
  assert.equal(c.supabaseUrl, null);
  assert.equal(c.supabaseKey, null);
  // Anything other than '1' is not the flag.
  assert.equal(resolveConfig({ supabaseUrl: URL_OK, supabaseKey: PUBLISHABLE, demo: 'true' }, ios).demo, false);
  assert.equal(resolveConfig({ supabaseUrl: URL_OK, supabaseKey: PUBLISHABLE, demo: '0' }, ios).demo, false);
});

test('demo mode switches on by itself when Supabase is missing or malformed', () => {
  assert.equal(resolveConfig({}, ios).demoReason, 'not_configured');
  assert.equal(resolveConfig({ supabaseUrl: URL_OK }, ios).demoReason, 'not_configured');
  assert.equal(resolveConfig({ supabaseKey: PUBLISHABLE }, ios).demoReason, 'not_configured');
  assert.equal(resolveConfig({ supabaseUrl: '   ', supabaseKey: PUBLISHABLE }, ios).demoReason, 'not_configured');
  // Plain http only for a local Supabase; no paths, no credentials.
  assert.equal(resolveConfig({ supabaseUrl: 'http://abc.supabase.co', supabaseKey: PUBLISHABLE }, ios).demoReason, 'not_configured');
  assert.equal(resolveConfig({ supabaseUrl: `${URL_OK}/rest/v1`, supabaseKey: PUBLISHABLE }, ios).demoReason, 'not_configured');
  assert.equal(resolveConfig({ supabaseUrl: 'https://user:pw@abc.supabase.co', supabaseKey: PUBLISHABLE }, ios).demoReason, 'not_configured');
  const local = resolveConfig({ supabaseUrl: 'http://127.0.0.1:54321/', supabaseKey: PUBLISHABLE }, ios);
  assert.equal(local.demo, false);
  assert.equal(local.supabaseUrl, 'http://127.0.0.1:54321');
});

test('only publishable keys are accepted: secret and service_role keys turn the app into a demo', () => {
  assert.equal(isPublishableKey(PUBLISHABLE), true);
  assert.equal(isPublishableKey(jwt({ role: 'anon', iss: 'supabase' })), true);
  assert.equal(isPublishableKey('sb_secret_abc123'), false);
  assert.equal(isPublishableKey(jwt({ role: 'service_role', iss: 'supabase' })), false);
  assert.equal(isPublishableKey(jwt({ role: 'authenticated' })), false);
  assert.equal(isPublishableKey('not.a.jwt'), false);
  assert.equal(isPublishableKey(''), false);
  assert.equal(isPublishableKey(undefined), false);
  const c = resolveConfig({ supabaseUrl: URL_OK, supabaseKey: 'sb_secret_abc123' }, ios);
  assert.equal(c.demo, true);
  assert.equal(c.demoReason, 'invalid_key');
  assert.equal(c.supabaseKey, null, 'a refused key is not kept in the config');
});

test('the web talks to its own origin; the apps to EXPO_PUBLIC_API_URL or reeltale.net', () => {
  assert.equal(resolveApiUrl({}, { os: 'web', webOrigin: 'https://staging.reeltale.net' }), 'https://staging.reeltale.net');
  assert.equal(resolveApiUrl({ apiUrl: 'https://other.example' }, { os: 'web', webOrigin: 'http://localhost:8790' }), 'http://localhost:8790');
  // An origin the client wouldn't accept (plain http on a public host) falls back.
  assert.equal(resolveApiUrl({}, { os: 'web', webOrigin: 'http://example.com' }), DEFAULT_API_URL);
  assert.equal(resolveApiUrl({}, { os: 'web', webOrigin: null }), DEFAULT_API_URL);
  assert.equal(resolveApiUrl({}, ios), DEFAULT_API_URL);
  assert.equal(resolveApiUrl({ apiUrl: 'https://staging.reeltale.net/' }, { os: 'android' }), 'https://staging.reeltale.net');
  assert.equal(resolveApiUrl({ apiUrl: 'http://10.0.2.2:8787' }, { os: 'android' }), 'http://10.0.2.2:8787');
  assert.equal(resolveApiUrl({ apiUrl: 'http://evil.example' }, ios), DEFAULT_API_URL);
  assert.equal(resolveApiUrl({ apiUrl: 'https://reeltale.net/api' }, ios), DEFAULT_API_URL);
  assert.equal(isUsableApiUrl('ftp://reeltale.net'), false);
});
