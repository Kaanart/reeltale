import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EpisodePrice } from '@reeltale/shared';
import {
  listNeedsPrice, listState, PLAYER_ASPECT, SHORTCUT_HINTS, SHORTCUT_KEYS, shortcutFor, theaterLayout,
  THEATER_MIN_COLUMN, unlockPresentation,
} from '../../features/watch/logic/desktop.ts';
import { pageForKey } from '../../features/watch/logic/pager.ts';
import type { EpisodeRow, SeriesRow } from '../../lib/types.ts';
import { breakpoints, layout } from '../../theme/tokens.ts';

// The player on a laptop: the theatre layout (a 9:16 player at full height beside a side panel), the
// unlock dialog, the keyboard shortcuts and the side panel's episode list.

const WEB = { web: true, gutter: layout.gutterWide };

// ---- Theatre layout ----------------------------------------------------------------------------------

test('a laptop window gets the theatre: a 9:16 player as tall as the area, beside the panel', () => {
  // 1440 x 900 with the site's top bar (64) and the demo ribbon (20): 816 high.
  const l = theaterLayout({ width: 1440, height: 816, ...WEB });
  assert.ok(l);
  assert.equal(l.columnHeight, 816 - 2 * l.padding);
  assert.ok(Math.abs(l.columnWidth / l.columnHeight - PLAYER_ASPECT) < 0.01);
  assert.equal(l.panelWidth, layout.sidePanelWidth);
  assert.equal(l.groupWidth, l.columnWidth + l.gap + l.railWidth + l.gap + l.panelWidth);
  assert.ok(l.groupWidth <= 1440 - 2 * WEB.gutter, 'the whole group fits between the gutters');
  assert.ok(l.groupWidth <= layout.contentMaxWidth, 'and within the page column');
});

test('common laptop sizes all fit, and the player never gets wider than the room beside the panel', () => {
  for (const [width, height] of [[1280, 656], [1366, 600], [1536, 750], [1920, 950], [1024, 684], [800, 516]] as const) {
    const l = theaterLayout({ width, height, web: true, gutter: width >= breakpoints.wide ? layout.gutterWide : layout.gutterMedium });
    assert.ok(l, `${width}x${height}`);
    assert.ok(l.columnWidth >= THEATER_MIN_COLUMN, `${width}x${height}`);
    assert.ok(l.columnHeight <= height - 2 * l.padding, `${width}x${height}: fits the height`);
    assert.ok(l.groupWidth <= width - 2 * layout.gutterMedium, `${width}x${height}: fits the width`);
  }
});

test('a narrow, tall window keeps 9:16 by letting the width decide', () => {
  const l = theaterLayout({ width: 800, height: 1200, web: true, gutter: layout.gutterMedium });
  assert.ok(l);
  assert.ok(l.columnHeight < 1200 - 2 * l.padding, 'shorter than the area');
  assert.ok(Math.abs(l.columnWidth / l.columnHeight - PLAYER_ASPECT) < 0.01);
});

test('phones, the apps, short windows and unmeasured areas keep the full-screen player', () => {
  assert.equal(theaterLayout({ width: 390, height: 780, ...WEB }), null, 'phone-sized browser');
  assert.equal(theaterLayout({ width: breakpoints.medium - 1, height: 900, ...WEB }), null, 'just below medium');
  assert.equal(theaterLayout({ width: 1440, height: 816, web: false, gutter: 32 }), null, 'native app on a tablet');
  assert.equal(theaterLayout({ width: 1440, height: 300, ...WEB }), null, 'too short for a useful player');
  assert.equal(theaterLayout({ width: 0, height: 0, ...WEB }), null, 'not measured yet');
  assert.equal(theaterLayout({ width: Number.NaN, height: 800, ...WEB }), null);
  assert.ok(theaterLayout({ width: breakpoints.medium, height: 700, web: true, gutter: layout.gutterMedium }), 'from medium on');
});

test('the unlock sheet is a dialog wherever the site shows its top bar', () => {
  assert.equal(unlockPresentation(true, 'wide'), 'dialog');
  assert.equal(unlockPresentation(true, 'medium'), 'dialog');
  assert.equal(unlockPresentation(true, 'compact'), 'sheet');
  assert.equal(unlockPresentation(false, 'wide'), 'sheet');
});

// ---- Keyboard ------------------------------------------------------------------------------------------

test('Space and K play or pause, M mutes, C switches captions; other keys are not ours', () => {
  const free = { onControl: false };
  assert.equal(shortcutFor(' ', free), 'togglePlay');
  assert.equal(shortcutFor('k', free), 'togglePlay');
  assert.equal(shortcutFor('K', free), 'togglePlay');
  assert.equal(shortcutFor('m', free), 'mute');
  assert.equal(shortcutFor('M', free), 'mute');
  assert.equal(shortcutFor('c', free), 'captions');
  for (const key of ['ArrowUp', 'ArrowDown', 'PageDown', 'Home', 'End', 'Enter', 'Escape', 'Tab', 'x', 'Meta', '']) {
    assert.equal(shortcutFor(key, free), null, key);
  }
});

test('Space on a focused button or link presses it instead of pausing (no double toggle)', () => {
  assert.equal(shortcutFor(' ', { onControl: true }), null);
  // Letters don't press buttons, so they still work there.
  assert.equal(shortcutFor('m', { onControl: true }), 'mute');
  assert.equal(shortcutFor('k', { onControl: true }), 'togglePlay');
});

test('the shortcuts never take the pager’s keys, and the hint lists what really works', () => {
  for (const key of Object.values(SHORTCUT_KEYS)) {
    assert.equal(pageForKey(key, 1, 3), null, key);
    assert.equal(pageForKey(key.toUpperCase(), 1, 3), null, key);
  }
  assert.equal(pageForKey('ArrowUp', 1, 3), 0);
  assert.equal(pageForKey('ArrowDown', 1, 3), 2);
  const shown = SHORTCUT_HINTS.flatMap((h) => h.keys);
  for (const key of Object.values(SHORTCUT_KEYS)) assert.ok(shown.includes(key.toUpperCase()), key);
  for (const hint of SHORTCUT_HINTS.filter((h) => h.id !== 'switch')) {
    for (const key of hint.keys) {
      const pressed = key === 'space' ? ' ' : key;
      assert.notEqual(shortcutFor(pressed, { onControl: false }), null, `${hint.id}: ${key}`);
    }
  }
});

// ---- The side panel's episode list ----------------------------------------------------------------------

const series = (over: Partial<SeriesRow> = {}) => ({
  status: 'published', free_episode_count: 3, format: 'live_action', editors_pick: false, ...over,
}) as Pick<SeriesRow, 'status' | 'free_episode_count' | 'format' | 'editors_pick'>;
const episode = (over: Partial<EpisodeRow> = {}) => ({
  number: 5, is_free: false, status: 'published', moderation_status: 'approved', ...over,
}) as Pick<EpisodeRow, 'number' | 'is_free' | 'status' | 'moderation_status'>;
const price = (over: Partial<EpisodePrice> = {}): EpisodePrice => ({
  purchasable: true, free: false, own: false, base_price: 20, discount_pct: 0, price: 20, reason: 'priced', unlocked: false, ...over,
});

test('episodes free by the series’ own rule cost no price request', () => {
  assert.equal(listNeedsPrice(series(), episode({ number: 2 })), false, 'one of the free first episodes');
  assert.equal(listNeedsPrice(series(), episode({ is_free: true })), false, 'marked free');
  assert.equal(listNeedsPrice(series({ format: 'ai_generated' }), episode()), false, 'a free AI story');
  assert.deepEqual(listState(series(), episode({ number: 1 }), undefined), { kind: 'free' });

  assert.equal(listNeedsPrice(series(), episode()), true, 'a paid episode');
  assert.equal(listNeedsPrice(series({ format: 'ai_generated', editors_pick: true }), episode()), true, 'Editor’s Pick AI');
  assert.equal(listNeedsPrice(series({ status: 'hidden' }), episode({ number: 1 })), true, 'hidden series: ask the server');
  assert.equal(listNeedsPrice(series(), episode({ number: 1, status: 'closed_to_new' })), true, 'closed: ask the server');
});

test('a paid episode’s row follows the server’s answer', () => {
  assert.deepEqual(listState(series(), episode(), undefined), { kind: 'loading' });
  assert.deepEqual(listState(series(), episode(), null), { kind: 'loading' });
  assert.deepEqual(listState(series(), episode(), price()), { kind: 'locked', price: 20, basePrice: 20, discounted: false });
  assert.deepEqual(
    listState(series(), episode(), price({ price: 15, discount_pct: 25 })),
    { kind: 'locked', price: 15, basePrice: 20, discounted: true },
  );
  assert.deepEqual(listState(series(), episode(), price({ unlocked: true })), { kind: 'unlocked' });
  assert.deepEqual(listState(series(), episode(), price({ own: true, free: true, reason: 'own_episode' })), { kind: 'own' });
  assert.deepEqual(listState(series(), episode(), price({ free: true, price: 0, base_price: 0, reason: 'free' })), { kind: 'free' });
  assert.deepEqual(
    listState(series(), episode(), price({ purchasable: false, reason: 'mature_opt_in_required' })),
    { kind: 'unavailable' },
  );
});

test('a buyer keeps a closed episode: the row says unlocked, not unavailable (like the player)', () => {
  const closed = episode({ status: 'closed_to_new' });
  const answer = price({ purchasable: false, unlocked: true, reason: 'not_available' });
  assert.deepEqual(listState(series(), closed, answer), { kind: 'unlocked' });
  assert.deepEqual(listState(series(), episode({ status: 'removed' }), answer), { kind: 'unavailable' });
  assert.deepEqual(listState(series(), closed, price({ purchasable: false, reason: 'not_available' })), { kind: 'unavailable' });
});

// ---- Strings and wiring -------------------------------------------------------------------------------

const src = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(`${src}${path}`, 'utf8');
type Tree = { [key: string]: Tree | string };
const watch = JSON.parse(read('i18n/en/watch.json')) as Tree;
const at = (tree: Tree, path: string): unknown => path.split('.').reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree);

test('every shortcut in the hint has its text, and the panel’s strings exist', () => {
  for (const hint of SHORTCUT_HINTS) assert.equal(typeof at(watch, `shortcuts.${hint.id}`), 'string', hint.id);
  for (const key of ['title', 'space']) assert.equal(typeof at(watch, `shortcuts.${key}`), 'string', key);
  for (const key of ['a11y', 'meta', 'follow', 'following', 'nowPlaying', 'episodes', 'playing', 'onScreen', 'own', 'unavailable', 'report']) {
    assert.equal(typeof at(watch, `panel.${key}`), 'string', `panel.${key}`);
  }
});

test('the browser tab is titled after the visible episode, and the wide layout is wired in', () => {
  const screen = read('features/watch/screens/WatchScreen.tsx');
  assert.match(screen, /usePageTitle\(title\)/);
  assert.match(screen, /theaterLayout\(/);
  assert.match(screen, /presentation=\{unlockPresentation\(/);
  assert.match(screen, /usePlayerShortcuts\(keysOn/);
  // The shortcuts stop whenever the pager's arrows do.
  assert.match(screen, /const keysOn = focused && sheetEpisode === null && endedId === null;/);
  const sheet = read('features/watch/components/UnlockSheet.tsx');
  assert.match(sheet, /presentation === 'dialog' \? Dialog : Sheet/);
});

test('the dialog closes on Escape and keeps focus inside: it is a Modal, with nothing focusable behind the card', () => {
  const dialog = read('features/watch/components/Dialog.tsx');
  assert.match(dialog, /<Modal[\s\S]*onRequestClose=\{onClose\}/, 'react-native-web calls onRequestClose on Escape');
  assert.match(dialog, /aria-labelledby=/);
  // The scrim is a plain view after the card: the focus trap must never land on it.
  assert.doesNotMatch(dialog, /<Pressable[^>]*style=\{styles\.scrim\}/);
  assert.ok(dialog.indexOf('styles.card') < dialog.indexOf('styles.scrim}'));
});

test('on the web only the visible page can be tabbed into, and the panel scrolls only itself', () => {
  const page = read('features/watch/components/EpisodePage.tsx');
  // A neighbour's Unlock button must not take focus: the browser would scroll the pager to it.
  assert.match(page, /if \(Platform\.OS !== 'web'\) return;[\s\S]*node\.inert = !active;/);
  assert.match(page, /<View ref=\{pageRef\}/);
  const panel = read('features/watch/components/WatchPanel.tsx');
  // scrollIntoView would scroll the pager as well (and can stop its smooth page change).
  assert.doesNotMatch(panel, /scrollIntoView(\?\.)?\(/);
  assert.match(panel, /getScrollableNode/);
});

test('the side panel sells nothing and shows prices in coins only', () => {
  const panel = read('features/watch/components/WatchPanel.tsx');
  assert.doesNotMatch(panel, /approx=\{(?!null\})/);
  assert.doesNotMatch(panel, /useUnlockEpisode|useFreePass|\.mutate\(\{ episodeId/);
  // The web-only shortcut code stays out of the native bundle.
  const files = readdirSync(`${src}features/watch`);
  assert.ok(files.includes('usePlayerShortcuts.ts') && files.includes('usePlayerShortcuts.web.ts'));
  assert.doesNotMatch(read('features/watch/usePlayerShortcuts.ts'), /window|document/);
});
