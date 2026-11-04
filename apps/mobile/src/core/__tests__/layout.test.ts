import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeNavKey, columnWidth, defaultTitleKey, formatPageTitle, gridColumns, gridItemWidth, gutterFor, isWalletPath,
  layoutSizeFor, maxWidthFor, NAV_ITEMS, navMatch, normalizePath,
} from '../../components/layout/logic.ts';
import { createShellStore } from '../../components/layout/shellStore.ts';
import { breakpoints, layout } from '../../theme/tokens.ts';

// The web shell's pure logic (src/components/layout/logic.ts and shellStore.ts).

test('size classes: compact below 768, medium below 1100, wide from 1100', () => {
  assert.equal(breakpoints.medium, 768);
  assert.equal(breakpoints.wide, 1100);
  assert.equal(layoutSizeFor(320), 'compact');
  assert.equal(layoutSizeFor(390), 'compact');
  assert.equal(layoutSizeFor(767), 'compact');
  assert.equal(layoutSizeFor(767.9), 'compact');
  assert.equal(layoutSizeFor(768), 'medium');
  assert.equal(layoutSizeFor(1024), 'medium');
  assert.equal(layoutSizeFor(1099), 'medium');
  assert.equal(layoutSizeFor(1100), 'wide');
  assert.equal(layoutSizeFor(1440), 'wide');
  assert.equal(layoutSizeFor(2560), 'wide');
});

test('an unmeasured window (server render, first frame) counts as compact', () => {
  for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(layoutSizeFor(w), 'compact', String(w));
  }
});

test('gutters grow with the window, and the content column is capped at 1200', () => {
  assert.equal(gutterFor('compact'), 16);
  assert.equal(gutterFor('medium'), 24);
  assert.equal(gutterFor('wide'), 32);
  assert.equal(maxWidthFor('content'), layout.contentMaxWidth);
  assert.equal(layout.contentMaxWidth, 1200);
  assert.equal(maxWidthFor('reading'), 760);
  assert.equal(maxWidthFor('narrow'), 560);
  assert.equal(maxWidthFor('full'), null);
  assert.equal(columnWidth(390), 390 - 32);
  assert.equal(columnWidth(1024), 1024 - 48);
  assert.equal(columnWidth(1440), 1200, 'capped');
  assert.equal(columnWidth(1440, 'reading'), 760);
  assert.equal(columnWidth(1440, 'full'), 1440 - 64);
  assert.equal(columnWidth(0), 0);
  assert.equal(columnWidth(Number.NaN), 0);
});

test('grids use as many columns as keep each card at least minItemWidth wide', () => {
  const opts = { minItemWidth: 160, gap: 16 };
  assert.equal(gridColumns(358, opts), 2, 'a phone: two covers');
  assert.equal(gridColumns(336, opts), 2, 'two 160s and a 16 gap fit exactly');
  assert.equal(gridColumns(335.9, opts), 1, 'a hair less does not');
  assert.equal(gridColumns(159, opts), 1, 'never fewer than one');
  assert.equal(gridColumns(0, opts), 1);
  assert.equal(gridColumns(976, opts), 5);
  assert.equal(gridColumns(1200, opts), 6, '7 x 160 + 6 x 16 = 1216 does not fit');
  assert.equal(gridColumns(1216, opts), 7);
  assert.equal(gridColumns(1200, { ...opts, maxColumns: 5 }), 5);
  assert.equal(gridColumns(100, { ...opts, minColumns: 2 }), 2);
  assert.equal(gridColumns(1200, { ...opts, minColumns: 9, maxColumns: 6 }), 9, 'minColumns wins a contradiction');
  // Every item really is at least minItemWidth wide at the chosen count.
  for (let w = 160; w <= 2000; w += 7) {
    const cols = gridColumns(w, opts);
    assert.ok(gridItemWidth(w, cols, 16) >= 160 - 1, `${w}px: ${cols} columns`);
    assert.ok(gridItemWidth(w, cols + 1, 16) < 160, `${w}px: ${cols + 1} would also fit`);
  }
});

test('grid items fill the row exactly (rounded down, never overflowing)', () => {
  assert.equal(gridItemWidth(1200, 4, 16), 288);
  assert.equal(gridItemWidth(1000, 3, 16), 322);
  assert.ok(gridItemWidth(1000, 3, 16) * 3 + 16 * 2 <= 1000);
  assert.equal(gridItemWidth(0, 3, 16), 0);
  assert.equal(gridItemWidth(10, 3, 16), 0, 'never negative');
  assert.equal(gridItemWidth(500, 0, 16), 500, 'zero columns counts as one');
});

test('the five tabs, in order, each with a route, a URL and a common:nav label', () => {
  assert.deepEqual(NAV_ITEMS.map((i) => i.key), ['home', 'discover', 'create', 'library', 'me']);
  assert.deepEqual(NAV_ITEMS.map((i) => i.route), ['index', 'discover', 'create', 'library', 'me']);
  assert.deepEqual(NAV_ITEMS.map((i) => i.href), ['/', '/discover', '/create', '/library', '/me']);
  for (const item of NAV_ITEMS) assert.equal(item.labelKey, `common:nav.${item.key}`);
});

test('paths are compared without query, hash or trailing slash', () => {
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath('/discover/'), '/discover');
  assert.equal(normalizePath('/discover?focus=search'), '/discover');
  assert.equal(normalizePath('/discover#x'), '/discover');
  assert.equal(normalizePath('discover'), '/discover');
  assert.equal(normalizePath('//'), '/');
});

test('the active nav link: the page itself, or the section it belongs to', () => {
  assert.equal(navMatch('/', 'home'), 'page');
  assert.equal(navMatch('/discover', 'discover'), 'page');
  assert.equal(navMatch('/discover?ranking=new', 'discover'), 'page');
  assert.equal(navMatch('/create', 'create'), 'page');
  assert.equal(navMatch('/story/new', 'create'), 'section');
  assert.equal(navMatch('/story/abc', 'create'), 'section');
  assert.equal(navMatch('/storyline', 'create'), null, 'a prefix is a whole segment');
  assert.equal(navMatch('/me', 'me'), 'page');
  assert.equal(navMatch('/settings', 'me'), 'section');
  assert.equal(navMatch('/settings/blocked', 'me'), 'section');
  assert.equal(navMatch('/discover', 'home'), null, 'Home is only /');
  assert.equal(navMatch('/series/x', 'home'), null);
  assert.equal(activeNavKey('/'), 'home');
  assert.equal(activeNavKey('/library'), 'library');
  assert.equal(activeNavKey('/story/new'), 'create');
  assert.equal(activeNavKey('/vip'), 'me');
  assert.equal(activeNavKey('/series/abc'), null);
  assert.equal(activeNavKey('/watch/1'), null);
  assert.equal(activeNavKey('/wallet'), null, 'the wallet has its own chip');
  assert.equal(isWalletPath('/wallet'), true);
  assert.equal(isWalletPath('/wallet/'), true);
  assert.equal(isWalletPath('/wallets'), false);
});

test('page titles read "<Page> · ReelTale", or just the app name', () => {
  assert.equal(formatPageTitle('Discover', 'ReelTale'), 'Discover · ReelTale');
  assert.equal(formatPageTitle('  The   Last Train ', 'ReelTale'), 'The Last Train · ReelTale', 'whitespace collapsed');
  assert.equal(formatPageTitle('', 'ReelTale'), 'ReelTale');
  assert.equal(formatPageTitle('   ', 'ReelTale'), 'ReelTale');
  assert.equal(formatPageTitle(null, 'ReelTale'), 'ReelTale');
  assert.equal(formatPageTitle(undefined, 'ReelTale'), 'ReelTale');
  assert.equal(formatPageTitle('ReelTale', 'ReelTale'), 'ReelTale', 'never "ReelTale · ReelTale"');
});

test('the tabs have default titles (their names); other paths have none', () => {
  assert.equal(defaultTitleKey('/'), 'common:nav.home');
  assert.equal(defaultTitleKey('/discover'), 'common:nav.discover');
  assert.equal(defaultTitleKey('/create/'), 'common:nav.create');
  assert.equal(defaultTitleKey('/library'), 'common:nav.library');
  assert.equal(defaultTitleKey('/me'), 'common:nav.me');
  assert.equal(defaultTitleKey('/series/x'), null);
  assert.equal(defaultTitleKey('/welcome'), null);
});

test('the shell store: the newest focused title wins, and removing it falls back', () => {
  const store = createShellStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  assert.deepEqual(store.get(), { title: null, topNavHidden: false });

  const removeA = store.pushTitle('Series A');
  assert.equal(store.get().title, 'Series A');
  const removeB = store.pushTitle('Wallet');
  assert.equal(store.get().title, 'Wallet');
  removeA(); // A blurs after B gained focus: B stays
  assert.equal(store.get().title, 'Wallet');
  removeB();
  assert.equal(store.get().title, null);
  removeB(); // twice is harmless
  assert.equal(store.get().title, null);
  assert.equal(calls, 3, 'one notification per change, none for no-ops');

  const snap = store.get();
  assert.equal(store.get(), snap, 'the snapshot is stable between changes (useSyncExternalStore)');
  unsubscribe();
  store.pushTitle('Unheard');
  assert.equal(calls, 3);
});

test('the shell store: the top bar stays hidden while any screen asks', () => {
  const store = createShellStore();
  const a = store.hideTopNav();
  const b = store.hideTopNav();
  assert.equal(store.get().topNavHidden, true);
  a();
  assert.equal(store.get().topNavHidden, true);
  b();
  assert.equal(store.get().topNavHidden, false);
  b();
  assert.equal(store.get().topNavHidden, false);
});
