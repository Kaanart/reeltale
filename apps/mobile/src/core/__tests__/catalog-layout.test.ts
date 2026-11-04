import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnWidth } from '../../components/layout/logic.ts';
import { demoCatalog } from '../../features/catalog/demo.ts';
import {
  canStickSide, CONTINUE_MAX_CARDS, CONTINUE_MIN_CARD_WIDTH, EPISODE_BATCH, featuredSeries, filterPanelWidth,
  heroCoverWidth, hiddenEpisodeCount, isPlainClick, nearEnd, nextEpisodeCount, pairShelves, rowWidth,
  SERIES_SIDE_MIN_WIDTH, SERIES_SIDE_WIDTH, seriesSideWidth, SHELF_GAP, SHELF_MAX_CARDS, SHELF_MIN_CARD_WIDTH,
  shelfArrows, shelfLayout, shelfOverflows, shelfScrollTarget,
} from '../../features/catalog/layout.ts';
import { layout } from '../../theme/tokens.ts';

// The catalog's layout on wider windows (src/features/catalog/layout.ts): shelves with arrows, the results
// grid beside the filter panel, the series page's side panel, Home's featured story.

// ---- Shelves ---------------------------------------------------------------------------------------------

test('a wide shelf shows more covers the wider the page, and they fill the row exactly', () => {
  // The page column at common laptop widths (PageContainer: 1200 at most, minus the gutters).
  const cases: [number, number][] = [[768, 4], [1024, 5], [1280, 6], [1440, 6], [1600, 6]];
  for (const [windowWidth, expected] of cases) {
    const width = columnWidth(windowWidth);
    const shelf = shelfLayout(width);
    assert.equal(shelf.perView, expected, `${windowWidth}px window`);
    assert.ok(shelf.cardWidth >= SHELF_MIN_CARD_WIDTH, `${windowWidth}: ${shelf.cardWidth}`);
    assert.ok(Number.isInteger(shelf.cardWidth));
    const used = rowWidth(shelf.perView, shelf.cardWidth, SHELF_GAP);
    assert.ok(used <= width, `${windowWidth}: the row is wider than the page`);
    assert.ok(width - used < shelf.perView, `${windowWidth}: rounding wastes more than a pixel per card`);
    assert.equal(shelf.step, shelf.cardWidth + SHELF_GAP);
  }
});

test('a shelf never gets more than its maximum, and never less than one card', () => {
  assert.equal(shelfLayout(5000).perView, SHELF_MAX_CARDS);
  assert.equal(shelfLayout(100).perView, 1);
  assert.equal(shelfLayout(0).perView, 1);
  assert.equal(shelfLayout(Number.NaN).cardWidth, 0);
  const resume = shelfLayout(1200, { minCardWidth: CONTINUE_MIN_CARD_WIDTH, maxCards: CONTINUE_MAX_CARDS });
  assert.equal(resume.perView, 4);
  assert.ok(resume.cardWidth >= CONTINUE_MIN_CARD_WIDTH);
  assert.equal(shelfLayout(720, { minCardWidth: CONTINUE_MIN_CARD_WIDTH, maxCards: CONTINUE_MAX_CARDS }).perView, 2);
});

test('rows: no cards take no room, one card has no gap', () => {
  assert.equal(rowWidth(0, 180, 16), 0);
  assert.equal(rowWidth(1, 180, 16), 180);
  assert.equal(rowWidth(3, 180, 16), 3 * 180 + 2 * 16);
  assert.equal(rowWidth(-2, 180, 16), 0);
});

test('a shelf needs arrows only when its cards do not all fit', () => {
  assert.equal(shelfOverflows(6, 6), false);
  assert.equal(shelfOverflows(5, 6), false);
  assert.equal(shelfOverflows(7, 6), true);
  assert.equal(shelfOverflows(0, 1), false);
});

test('the arrows know where the shelf is: back is off at the start, forward is off at the end', () => {
  const content = rowWidth(12, 180, 16);
  const viewport = rowWidth(6, 180, 16);
  assert.deepEqual(shelfArrows({ offset: 0, viewport, content }), { prev: false, next: true });
  assert.deepEqual(shelfArrows({ offset: 300, viewport, content }), { prev: true, next: true });
  assert.deepEqual(shelfArrows({ offset: content - viewport, viewport, content }), { prev: true, next: false });
  // Sub-pixel scroll positions (browser zoom) still count as the start and the end.
  assert.deepEqual(shelfArrows({ offset: 0.5, viewport, content }), { prev: false, next: true });
  assert.deepEqual(shelfArrows({ offset: content - viewport - 0.4, viewport, content }), { prev: true, next: false });
  // Everything fits: no arrow does anything.
  assert.deepEqual(shelfArrows({ offset: 0, viewport: 1200, content: 800 }), { prev: false, next: false });
});

test('an arrow moves the shelf one view of whole cards, lined up on a card, never past either end', () => {
  const shelf = shelfLayout(1200);
  const n = 12;
  const content = rowWidth(n, shelf.cardWidth, shelf.gap);
  const viewport = 1200;
  const max = content - viewport;
  const at = (offset: number) => ({ offset, viewport, content });

  const first = shelfScrollTarget(at(0), 'next', shelf);
  assert.equal(first, Math.min(max, shelf.perView * shelf.step));
  assert.equal(first % shelf.step === 0 || first === max, true, 'starts at a card edge or the end');
  // Forward again: the end, and no further.
  assert.equal(shelfScrollTarget(at(first), 'next', shelf), max);
  assert.equal(shelfScrollTarget(at(max), 'next', shelf), max);
  // Back from the end and back to the start.
  const back = shelfScrollTarget(at(max), 'prev', shelf);
  assert.ok(back >= 0 && back < max);
  assert.equal(shelfScrollTarget(at(back), 'prev', shelf), 0);
  assert.equal(shelfScrollTarget(at(0), 'prev', shelf), 0);
  // Half-way between cards (a trackpad swipe): it lines up with the nearest card first.
  const half = shelf.step * 1.4;
  assert.equal(shelfScrollTarget(at(half), 'next', shelf), Math.min(max, (1 + shelf.perView) * shelf.step));
  assert.equal(shelfScrollTarget(at(half), 'prev', shelf), 0);
  // A row that fits never moves.
  assert.equal(shelfScrollTarget({ offset: 0, viewport: 1200, content: 900 }, 'next', shelf), 0);
});

test('short shelves share a row on Home, and their covers stay on the full rows’ grid', () => {
  const shelves = (...counts: number[]) => counts.map((n, i) => ({ id: `s${i}`, n }));
  const ids = (groups: readonly (readonly { id: string }[])[]) => groups.map((g) => g.map((s) => s.id).join('+'));
  const n = (s: { n: number }) => s.n;
  // The demo on a 1440 laptop: six covers a row, so shelves of three or fewer pair up, in order.
  assert.deepEqual(
    ids(pairShelves(shelves(5, 3, 1, 2, 2, 1, 1, 1), n, 6)),
    ['s0', 's1+s2', 's3+s4', 's5+s6', 's7'],
  );
  // A full shelf between two short ones keeps them apart; nothing is reordered.
  assert.deepEqual(ids(pairShelves(shelves(2, 6, 2), n, 6)), ['s0', 's1', 's2']);
  assert.deepEqual(ids(pairShelves(shelves(4, 1), n, 6)), ['s0', 's1'], 'four covers need more than half a row');
  // An odd number of covers a row (or too few) never pairs: the halves would not line up with the full rows.
  assert.deepEqual(ids(pairShelves(shelves(1, 1, 1), n, 5)), ['s0', 's1', 's2']);
  assert.deepEqual(ids(pairShelves(shelves(1, 1), n, 2)), ['s0', 's1']);
  assert.deepEqual(ids(pairShelves(shelves(1, 1), n, 0)), ['s0', 's1'], 'phones: one shelf a row');
  assert.deepEqual(ids(pairShelves(shelves(2, 2), n, 4)), ['s0+s1'], 'a tablet-sized window: two covers each');
  assert.deepEqual(ids(pairShelves(shelves(0, 1), n, 6)), ['s0', 's1'], 'an empty shelf never pairs');
  assert.deepEqual(pairShelves([], n, 6), []);

  // Why only even rows: two halves with the shelf gap between them hold exactly half the covers, as wide as
  // the full row's, at every page width that shows an even number.
  for (let width = 700; width <= 1200; width += 1) {
    const full = shelfLayout(width);
    if (full.perView % 2 !== 0 || full.perView < 4) continue;
    const half = shelfLayout(Math.floor((width - SHELF_GAP) / 2));
    assert.equal(half.perView, full.perView / 2, `${width}px`);
    assert.ok(Math.abs(half.cardWidth - full.cardWidth) <= 1, `${width}px: ${half.cardWidth} vs ${full.cardWidth}`);
  }
});

// ---- Long lists ------------------------------------------------------------------------------------------

test('Discover loads more when the reader nears the bottom, or when everything already fits', () => {
  assert.equal(nearEnd({ offset: 0, viewport: 800, content: 4000 }), false);
  assert.equal(nearEnd({ offset: 2500, viewport: 800, content: 4000 }), true, 'within 800px of the end');
  assert.equal(nearEnd({ offset: 3200, viewport: 800, content: 4000 }), true, 'at the end');
  assert.equal(nearEnd({ offset: 0, viewport: 900, content: 600 }), true, 'a short page');
  assert.equal(nearEnd({ offset: 0, viewport: 800, content: 1000 }, 100), false);
});

test('the series page shows episodes in batches, and never claims more than there are', () => {
  assert.equal(EPISODE_BATCH, 30);
  assert.equal(nextEpisodeCount(30, 100), 60);
  assert.equal(nextEpisodeCount(90, 100), 100);
  assert.equal(nextEpisodeCount(0, 8), 8);
  assert.equal(nextEpisodeCount(30, 0), 0);
  assert.equal(nextEpisodeCount(10, 100, 0), 11, 'a batch is at least one');
  assert.equal(hiddenEpisodeCount(30, 100), 70);
  assert.equal(hiddenEpisodeCount(30, 8), 0);
  assert.equal(hiddenEpisodeCount(-5, 8), 8);
});

// ---- Side panels -----------------------------------------------------------------------------------------

test('a side panel sticks only when all of it fits on screen', () => {
  assert.equal(canStickSide(700, 816), true, '1440x900 with the top bar');
  assert.equal(canStickSide(700, 640), false, 'a short laptop window');
  assert.equal(canStickSide(784, 816), true, 'exactly fits with 16px above and below');
  assert.equal(canStickSide(785, 816), false);
  assert.equal(canStickSide(0, 816), false, 'not measured yet');
  assert.equal(canStickSide(500, 0), false);
  assert.equal(canStickSide(Number.NaN, 800), false);
});

test('the series page’s side panel narrows in shorter windows so Play stays on screen', () => {
  assert.equal(seriesSideWidth(1000), SERIES_SIDE_WIDTH, 'a tall window gets the full panel');
  assert.equal(seriesSideWidth(1400), SERIES_SIDE_WIDTH);
  assert.equal(seriesSideWidth(900), 303, '1440x900');
  assert.equal(seriesSideWidth(800), SERIES_SIDE_MIN_WIDTH, '1280x800: never narrower than the buttons need');
  assert.equal(seriesSideWidth(600), SERIES_SIDE_MIN_WIDTH);
  assert.equal(seriesSideWidth(0), SERIES_SIDE_WIDTH, 'not measured yet');
  assert.equal(seriesSideWidth(Number.NaN), SERIES_SIDE_WIDTH);
  for (let h = 500; h <= 1600; h += 10) {
    const w = seriesSideWidth(h);
    assert.ok(Number.isInteger(w) && w >= SERIES_SIDE_MIN_WIDTH && w <= SERIES_SIDE_WIDTH, `${h}: ${w}`);
    assert.ok(w >= seriesSideWidth(h - 10), 'never narrower in a taller window');
  }
});

test('panel widths leave the main column room for a grid at every size', () => {
  assert.equal(filterPanelWidth('wide'), 264);
  assert.equal(filterPanelWidth('medium'), 232);
  // The results beside the filter panel still get at least three covers on a small laptop and two on a tablet.
  const results = (windowWidth: number, size: 'medium' | 'wide') => columnWidth(windowWidth) - filterPanelWidth(size) - 24;
  assert.ok(shelfLayout(results(1100, 'wide'), { maxCards: 6 }).perView >= 4);
  assert.ok(shelfLayout(results(768, 'medium'), { minCardWidth: 150 }).perView >= 2);
  assert.ok(SERIES_SIDE_WIDTH <= layout.sidePanelWidth);
  assert.ok(heroCoverWidth('wide') > heroCoverWidth('medium'));
});

// ---- Home's featured story -------------------------------------------------------------------------------

test('Home features an Editor’s Pick, preferring one that is not made with AI', () => {
  const card = (id: string, editors_pick: boolean, format: 'live_action' | 'stop_motion' | 'ai_generated', origin: 'creator' | 'ai_story' = 'creator') =>
    ({ id, editors_pick, format, origin });
  assert.equal(featuredSeries([]), null);
  assert.equal(featuredSeries([card('a', false, 'live_action')]), null, 'only picks are featured');
  assert.equal(featuredSeries([card('ai', true, 'ai_generated', 'ai_story'), card('sm', true, 'stop_motion')])?.id, 'sm');
  assert.equal(featuredSeries([card('ai', true, 'ai_generated', 'ai_story')])?.id, 'ai', 'an AI pick when it is the only one');
  assert.equal(featuredSeries([card('o', true, 'live_action', 'ai_story'), card('b', true, 'live_action')])?.id, 'b', 'an AI story by origin counts as AI');
  // The demo has two picks: the stop-motion one is featured.
  const picks = demoCatalog().filter((s) => s.editors_pick);
  assert.ok(picks.length >= 2);
  assert.equal(featuredSeries(picks)?.slug, 'the-clockmakers-mice');
});

// ---- Links -----------------------------------------------------------------------------------------------

test('only a plain click is handled in the app; modified clicks are left to the browser', () => {
  assert.equal(isPlainClick({ button: 0 }), true);
  assert.equal(isPlainClick({}), true, 'Enter on a link: a click without a button');
  assert.equal(isPlainClick({ button: 0, metaKey: true }), false, 'Cmd-click: new tab');
  assert.equal(isPlainClick({ button: 0, ctrlKey: true }), false);
  assert.equal(isPlainClick({ button: 0, shiftKey: true }), false);
  assert.equal(isPlainClick({ button: 0, altKey: true }), false);
  assert.equal(isPlainClick({ button: 1 }), false, 'middle button');
  assert.equal(isPlainClick({ button: 0, defaultPrevented: true }), false);
  assert.equal(isPlainClick(null), false);
});
