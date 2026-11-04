import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATE_PATHS, gateFor, isAuthGate, isPublicWebPath, pathOfSegments, PUBLIC_WEB_PATHS, redirectFor, stickyGate, termsAccepted,
  TERMS_VERSION, type Gate,
} from '../../lib/gate.ts';

const ok = (ageStatus: 'unknown' | 'adult' | 'blocked', tosVersion: string | null = null) =>
  ({ status: 'ok', row: { ageStatus, tosVersion } }) as const;

test('the gate follows the blueprint order: sign-in, date of birth, blocked, Terms, app', () => {
  assert.equal(gateFor('loading', { status: 'loading' }), 'loading');
  assert.equal(gateFor('none', { status: 'loading' }), 'signedOut');
  assert.equal(gateFor('none', ok('adult', TERMS_VERSION)), 'signedOut', 'no session wins over a cached account');
  assert.equal(gateFor('present', { status: 'loading' }), 'loading');
  assert.equal(gateFor('present', { status: 'error' }), 'error');
  assert.equal(gateFor('present', { status: 'ok', row: null }), 'age', 'no profile row yet = no date of birth yet');
  assert.equal(gateFor('present', ok('unknown')), 'age');
  assert.equal(gateFor('present', ok('unknown', TERMS_VERSION)), 'age', 'Terms never skip the 18+ gate');
  assert.equal(gateFor('present', ok('blocked')), 'blocked');
  assert.equal(gateFor('present', ok('blocked', TERMS_VERSION)), 'blocked');
  assert.equal(gateFor('present', ok('adult')), 'terms');
  assert.equal(gateFor('present', ok('adult', TERMS_VERSION)), 'ready');
});

test('Terms count as accepted for the current version or a newer one, never an older or malformed one', () => {
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/, 'public.accept_terms only takes YYYY-MM-DD');
  assert.equal(termsAccepted(TERMS_VERSION), true);
  assert.equal(termsAccepted('2099-01-01'), true);
  assert.equal(termsAccepted('2026-01-01'), false);
  assert.equal(termsAccepted(null), false);
  assert.equal(termsAccepted(undefined), false);
  assert.equal(termsAccepted('9999'), false);
  assert.equal(termsAccepted('latest'), false);
  assert.equal(gateFor('present', ok('adult', '2026-01-01')), 'terms', 'a new Terms version asks again');
});

test('loading and error keep the last settled gate on screen', () => {
  assert.equal(stickyGate('loading', null), 'signedOut');
  assert.equal(stickyGate('loading', 'ready'), 'ready');
  assert.equal(stickyGate('error', 'terms'), 'terms');
  assert.equal(stickyGate('age', 'signedOut'), 'age');
  assert.equal(stickyGate('signedOut', 'ready'), 'signedOut', 'sign-out is never sticky');
});

test('every auth gate has an (auth) screen, and only those are auth gates', () => {
  const all: Gate[] = ['loading', 'error', 'signedOut', 'age', 'blocked', 'terms', 'ready'];
  assert.deepEqual(all.filter(isAuthGate), ['signedOut', 'age', 'blocked', 'terms']);
  assert.deepEqual(Object.values(GATE_PATHS), ['/welcome', '/birthday', '/blocked', '/terms']);
});

test('feature routes outside the guarded groups send anyone not through the gate to the right screen', () => {
  assert.equal(redirectFor('signedOut', ['series', '[id]']), '/welcome');
  assert.equal(redirectFor('age', ['watch', '[episodeId]']), '/birthday');
  assert.equal(redirectFor('blocked', ['wallet']), '/blocked');
  assert.equal(redirectFor('terms', ['story', '[id]']), '/terms');
  // Through the gate, or not decided yet: nothing to do.
  assert.equal(redirectFor('ready', ['series', '[id]']), null);
  assert.equal(redirectFor('loading', ['series', '[id]']), null);
  assert.equal(redirectFor('error', ['series', '[id]']), null);
  // The groups the layouts guard with Stack.Protected, and the open routes, are left alone.
  assert.equal(redirectFor('signedOut', ['(auth)', 'welcome']), null);
  assert.equal(redirectFor('signedOut', ['(tabs)', 'discover']), null);
  assert.equal(redirectFor('signedOut', ['+not-found']), null);
  assert.equal(redirectFor('signedOut', []), null);
});

// ---- Public web pages (lib/gate.ts PUBLIC_WEB_PATHS) -------------------------------------------------------

const NOT_THROUGH: Gate[] = ['signedOut', 'age', 'blocked', 'terms'];

test('the public web pages are exactly /, /about and /notice', () => {
  assert.deepEqual([...PUBLIC_WEB_PATHS], ['/', '/about', '/notice']);
  for (const path of ['/', '/about', '/notice', '/about/', '/notice?x=1', '/about#top', '']) {
    assert.equal(isPublicWebPath(path), true, path);
  }
  // Exact paths only: no sub-paths, look-alikes or other routes.
  for (const path of ['/about/team', '/notice/123', '/aboutus', '/abo', '/series/about', '/wallet', '/discover', '/me', '/watch/1', '/redeem']) {
    assert.equal(isPublicWebPath(path), false, path);
  }
});

test('route segments map to their URL path without groups', () => {
  assert.equal(pathOfSegments([]), '/');
  assert.equal(pathOfSegments(['about']), '/about');
  assert.equal(pathOfSegments(['(public)', 'about']), '/about');
  assert.equal(pathOfSegments(['(public)']), '/');
  assert.equal(pathOfSegments(['about', 'index']), '/about');
  assert.equal(pathOfSegments(['series', '[slug]']), '/series/[slug]');
});

test('on the web, visitors and accounts not through the gate may open the public pages', () => {
  for (const gate of NOT_THROUGH) {
    assert.equal(redirectFor(gate, ['about'], { web: true }), null, `${gate} /about`);
    assert.equal(redirectFor(gate, ['notice'], { web: true }), null, `${gate} /notice`);
    assert.equal(redirectFor(gate, ['(public)', 'notice'], { web: true }), null, `${gate} /(public)/notice`);
  }
});

test('the public list never opens anything else: every other route still goes to the gate screen', () => {
  const featureRoutes: string[][] = [
    ['series', '[slug]'], ['watch', '[episodeId]'], ['wallet'], ['settings'], ['story', 'new'], ['story', '[id]'],
    ['report'], ['redeem'], ['vip'], ['about', 'team'], ['notice', '[id]'], ['(public)', 'wallet'],
  ];
  for (const gate of NOT_THROUGH) {
    for (const segments of featureRoutes) {
      assert.equal(redirectFor(gate, segments, { web: true }), GATE_PATHS[gate as keyof typeof GATE_PATHS], `${gate} ${segments.join('/')}`);
    }
  }
});

test('the native apps have no public pages: /about and /notice stay behind the gate there', () => {
  for (const gate of NOT_THROUGH) {
    const expected = GATE_PATHS[gate as keyof typeof GATE_PATHS];
    assert.equal(redirectFor(gate, ['about']), expected, `${gate} default`);
    assert.equal(redirectFor(gate, ['notice'], { web: false }), expected, `${gate} web: false`);
  }
});

test('signed-in adults are never redirected (they land on the tabs at /), public page or not', () => {
  for (const segments of [['about'], ['notice'], ['wallet'], ['(tabs)'], []]) {
    assert.equal(redirectFor('ready', segments, { web: true }), null);
    assert.equal(redirectFor('ready', segments), null);
  }
  // '/' itself: (tabs) is guarded by Stack.Protected, so redirectFor leaves it to the layout for every gate.
  assert.equal(redirectFor('signedOut', ['(tabs)'], { web: true }), null);
});
