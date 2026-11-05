import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoTags } from '../../demo/fixtures.ts';
import { demoCards } from '../../features/catalog/demo.ts';
import type { SeriesCard } from '../../features/catalog/logic.ts';
import {
  applyCarouselAction, ARRIVALS_MAX, buildStorefront, canSwitch, carouselKeyAction, CAROUSEL_INTERVAL_MS, COMPLETED_MAX,
  EDITORS_MAX, episodeSummary, FEATURED_PAGE, HERO_MAX, heroMode, heroSeries, isPlaceholder, newestFirst, nextWindowStart,
  padWithPlaceholders, popularTags, POSTER_MIN_WIDTH, posterColumns, primaryGenre, RANK_SIZE, rankLabel, rankTone, realItems,
  rotatingWindow, shouldAutoAdvance, uniqueById, wrapIndex,
} from '../../features/catalog/storefront.ts';
import { columnWidth, gridItemWidth } from '../../components/layout/logic.ts';
import { colors } from '../../theme/tokens.ts';

// Home's storefront (src/features/catalog/storefront.ts): what each section lists, the Weekly pick carousel
// and the Weekly featured Switch, and the contrast of the colours the storefront and the dark footer add.

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..');

function card(id: string, over: Partial<SeriesCard> = {}): SeriesCard {
  return {
    id,
    slug: `series-${id}`,
    title: `Series ${id}`,
    cover_key: null,
    format: 'live_action',
    origin: 'creator',
    editors_pick: false,
    maturity: 'general',
    completed: false,
    tag_ids: [],
    published_at: '2026-10-01T09:00:00Z',
    ...over,
  };
}

// ---- Sections ------------------------------------------------------------------------------------------

test('Weekly pick: Editor’s Picks first (one not made with AI leads), then Trending fills it, no repeats', () => {
  const ai = card('ai', { editors_pick: true, format: 'ai_generated', origin: 'ai_story' });
  const pick = card('pick', { editors_pick: true, format: 'stop_motion' });
  const trending = [card('t1'), pick, card('t2'), card('t3'), card('t4')];
  assert.deepEqual(heroSeries([ai, pick], trending).map((s) => s.id), ['pick', 'ai', 't1', 't2']);
  assert.equal(heroSeries([ai, pick], trending).length, HERO_MAX);
  assert.deepEqual(heroSeries([], trending, 3).map((s) => s.id), ['t1', 'pick', 't2'], 'no picks: Trending alone');
  assert.deepEqual(heroSeries([card('x')], [], 4), [], 'a series that is not a pick is not featured as one');
  assert.deepEqual(heroSeries([ai], []).map((s) => s.id), ['ai'], 'an AI pick when it is the only one');
  const aiVideo = card('aiv', { editors_pick: true, format: 'ai_generated', origin: 'creator' });
  assert.deepEqual(heroSeries([ai, aiVideo], []).map((s) => s.id), ['aiv', 'ai'], 'a creator series made with AI before an AI story');
  assert.deepEqual(heroSeries([], []), []);
});

test('the storefront’s sections come from the catalog’s own lists', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
  const pool = Array.from({ length: 12 }, (_, i) =>
    card(`s${i}`, { published_at: day(i + 1), completed: i % 4 === 0, editors_pick: i === 5 }));
  const store = buildStorefront({ pool, picks: pool.filter((s) => s.editors_pick), completed: pool.filter((s) => s.completed) });
  assert.equal(store.featured.length, 12, 'Weekly featured cycles through all of Trending');
  assert.deepEqual(store.rankings.trending.map((s) => s.id), ['s0', 's1', 's2', 's3', 's4'], 'Trending keeps the catalog order');
  assert.deepEqual(store.rankings.fresh.map((s) => s.id), ['s11', 's10', 's9', 's8', 's7'], 'New is newest first');
  assert.deepEqual(store.rankings.completed.map((s) => s.id), ['s0', 's4', 's8']);
  for (const list of Object.values(store.rankings)) assert.ok(list.length <= RANK_SIZE);
  assert.equal(store.arrivals.length, ARRIVALS_MAX);
  assert.equal(store.arrivals[0]?.id, 's11');
  assert.deepEqual(store.editors.map((s) => s.id), ['s5']);
  assert.equal(store.hero[0]?.id, 's5', 'the pick leads the carousel');
  assert.ok(store.completed.length <= COMPLETED_MAX && store.editors.length <= EDITORS_MAX);
});

test('the storefront drops what does not belong: repeats, non-picks under Editors’ choice, unfinished under Completed', () => {
  const a = card('a', { editors_pick: true, completed: true });
  const b = card('b');
  const store = buildStorefront({ pool: [a, b, a], picks: [a, b, a], completed: [b, a] });
  assert.deepEqual(store.featured.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(store.editors.map((s) => s.id), ['a']);
  assert.deepEqual(store.completed.map((s) => s.id), ['a']);
  const empty = buildStorefront<SeriesCard>({ pool: [], picks: [], completed: [] });
  assert.deepEqual(empty.hero, []);
  assert.deepEqual(empty.rankings, { trending: [], fresh: [], completed: [] });
});

test('the demo catalog fills every section, and mature series stay out for a reader who has not opted in', () => {
  const pool = demoCards({ ranking: 'trending', limit: 60 }, false);
  const store = buildStorefront({
    pool,
    picks: demoCards({ ranking: 'editorsPicks', limit: 12 }, false),
    completed: demoCards({ ranking: 'completed', limit: 12 }, false),
  });
  const all = [
    ...store.hero, ...store.featured, ...store.rankings.trending, ...store.rankings.fresh, ...store.rankings.completed,
    ...store.arrivals, ...store.editors, ...store.completed,
  ];
  assert.ok(all.length > 0);
  assert.ok(all.every((s) => s.maturity === 'general'), 'no mature series without the opt-in');
  assert.ok(store.hero.length >= 3, 'three or four slides');
  assert.equal(store.hero[0]?.slug, 'the-clockmakers-mice', 'a creator series leads, before the AI story');
  assert.ok(store.rankings.trending.length > 0 && store.rankings.fresh.length > 0 && store.rankings.completed.length > 0);
  assert.equal(store.rankings.fresh[0]?.slug, 'salt-and-static', 'the newest demo series');
});

test('newest first is by publish date, then id; series with no date go last', () => {
  const list = [card('b', { published_at: null }), card('a', { published_at: '2026-10-02T00:00:00Z' }), card('c', { published_at: '2026-10-02T00:00:00Z' })];
  assert.deepEqual(newestFirst(list).map((s) => s.id), ['a', 'c', 'b']);
  assert.deepEqual(uniqueById([card('x'), card('y'), card('x')]).map((s) => s.id), ['x', 'y']);
});

test('popular tags: the genres and tropes most series carry, none that lead nowhere, never content warnings', () => {
  const series = [
    card('1', { tag_ids: [3, 147] }),
    card('2', { tag_ids: [3, 1] }),
    card('3', { tag_ids: [1, 3, 3] }),
    card('4', { tag_ids: [8, 999] }),
  ];
  const tags = [...demoTags, { id: 999, kind: 'warning' as const, slug: 'gore', name_i18n: { en: 'Gore' }, sort: 1 }];
  const ids = popularTags(tags, series).map((t) => t.id);
  assert.deepEqual(ids, [3, 1, 8, 147], 'most used first; ties keep the catalog order, genres before tropes');
  assert.ok(!ids.includes(999), 'content warnings are not filters');
  assert.equal(popularTags(tags, series, 2).length, 2);
  assert.deepEqual(popularTags(tags, []), []);
});

test('a card names the series’ first genre, and episode lists give the count and the first episode', () => {
  assert.equal(primaryGenre(card('x', { tag_ids: [147, 3, 1] }), demoTags)?.slug, 'romance', 'catalog order, genres only');
  assert.equal(primaryGenre(card('x', { tag_ids: [147] }), demoTags), null, 'a trope is not a genre');
  assert.equal(primaryGenre(card('x', { tag_ids: [] }), demoTags), null);
  assert.deepEqual(episodeSummary([{ id: 'e3', number: 3 }, { id: 'e1', number: 1 }, { id: 'e2', number: 2 }]), { count: 3, firstId: 'e1' });
  assert.deepEqual(episodeSummary([]), { count: 0, firstId: null });
  assert.deepEqual(episodeSummary(undefined), { count: 0, firstId: null });
});

test('ranking numbers are two digits, and only the top three get a colour', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(rankLabel), ['01', '02', '03', '04', '05']);
  assert.equal(rankLabel(11), '12');
  assert.deepEqual([0, 1, 2, 3, 4].map(rankTone), ['first', 'second', 'third', null, null]);
});

// ---- The carousel --------------------------------------------------------------------------------------

test('the carousel goes round at both ends', () => {
  assert.equal(wrapIndex(4, 4), 0);
  assert.equal(wrapIndex(-1, 4), 3);
  assert.equal(wrapIndex(9, 4), 1);
  assert.equal(wrapIndex(2, 0), 0, 'an empty carousel');
  assert.equal(wrapIndex(Number.NaN, 3), 0);
  assert.equal(applyCarouselAction(0, 'prev', 4), 3);
  assert.equal(applyCarouselAction(3, 'next', 4), 0);
  assert.equal(applyCarouselAction(2, 'first', 4), 0);
  assert.equal(applyCarouselAction(0, 'last', 4), 3);
  assert.equal(applyCarouselAction(0, 'next', 0), 0);
});

test('arrow keys, Home and End move the carousel; other keys are left alone', () => {
  assert.equal(carouselKeyAction('ArrowLeft'), 'prev');
  assert.equal(carouselKeyAction('ArrowRight'), 'next');
  assert.equal(carouselKeyAction('Home'), 'first');
  assert.equal(carouselKeyAction('End'), 'last');
  for (const key of ['Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown', 'a']) assert.equal(carouselKeyAction(key), null, key);
});

test('the carousel moves by itself only when nobody is using it and motion is welcome', () => {
  const idle = { count: 4, paused: false, hovered: false, focused: false, reduceMotion: false, screenFocused: true };
  assert.equal(shouldAutoAdvance(idle), true);
  assert.equal(shouldAutoAdvance({ ...idle, paused: true }), false, 'Pause');
  assert.equal(shouldAutoAdvance({ ...idle, hovered: true }), false, 'under the mouse');
  assert.equal(shouldAutoAdvance({ ...idle, focused: true }), false, 'the keyboard focus is inside');
  assert.equal(shouldAutoAdvance({ ...idle, reduceMotion: true }), false, 'reduced motion');
  assert.equal(shouldAutoAdvance({ ...idle, screenFocused: false }), false, 'another screen is on show');
  assert.equal(shouldAutoAdvance({ ...idle, count: 1 }), false, 'one slide has nowhere to go');
  assert.ok(CAROUSEL_INTERVAL_MS >= 5000, 'slow enough to read a synopsis');
});

// ---- Weekly featured -----------------------------------------------------------------------------------

test('Switch shows the next eight, going round so every view is full', () => {
  const items = Array.from({ length: 11 }, (_, i) => i);
  assert.deepEqual(rotatingWindow(items, 0), [0, 1, 2, 3, 4, 5, 6, 7]);
  const next = nextWindowStart(0, items.length);
  assert.equal(next, FEATURED_PAGE);
  assert.deepEqual(rotatingWindow(items, next), [8, 9, 10, 0, 1, 2, 3, 4]);
  assert.equal(nextWindowStart(next, items.length), 5);
  assert.equal(rotatingWindow(items, 5).length, FEATURED_PAGE);
});

test('a list that fits in one view is shown whole, and Switch has nothing to do', () => {
  const items = [1, 2, 3, 4, 5];
  assert.equal(canSwitch(items.length), false);
  assert.equal(canSwitch(FEATURED_PAGE), false);
  assert.equal(canSwitch(FEATURED_PAGE + 1), true);
  assert.deepEqual(rotatingWindow(items, 3), items);
  assert.equal(nextWindowStart(3, items.length), 0);
  assert.deepEqual(rotatingWindow([], 0), []);
});

test('Weekly featured is one row of posters wide enough for the AI label, at every web width', () => {
  const GAP = 16;
  // 1440 x 900 (wide), 1024 x 768 (medium), the medium and wide edges.
  const expected: Record<number, number> = { 1440: 8, 1100: 7, 1024: 7, 768: 5 };
  for (const [win, cols] of Object.entries(expected)) {
    const row = columnWidth(Number(win));
    const n = posterColumns(row, GAP);
    assert.equal(n, cols, `${win} px window`);
    assert.ok(gridItemWidth(row, n, GAP) >= POSTER_MIN_WIDTH, `${win} px: posters at least ${POSTER_MIN_WIDTH} px`);
  }
  for (let win = 768; win <= 2560; win += 7) {
    const row = columnWidth(win);
    const n = posterColumns(row, GAP);
    assert.ok(n >= 1 && n <= FEATURED_PAGE);
    // A scrollbar (up to 17 px) can take some of the row: the posters still fit the label (107 px + 8 px inset).
    assert.ok(gridItemWidth(row - 17, n, GAP) >= 115, `${win} px with a scrollbar`);
  }
  assert.equal(posterColumns(0, GAP), 1);
});

// ---- "Coming soon" placeholders -----------------------------------------------------------------------

test('a short row is padded with placeholders after its real series, never past its size', () => {
  const row = padWithPlaceholders([card('a'), card('b')], 5);
  assert.equal(row.length, 5);
  assert.deepEqual(row.slice(0, 2).map((s) => (isPlaceholder(s) ? null : s.id)), ['a', 'b'], 'the real series come first, in order');
  assert.deepEqual(row.map(isPlaceholder), [false, false, true, true, true]);
  assert.deepEqual(realItems(row).map((s) => s.id), ['a', 'b']);
  const keys = row.map((s) => (isPlaceholder(s) ? s.key : s.id));
  assert.equal(new Set(keys).size, keys.length, 'every key in the row is unique');
});

test('a full row gets no placeholders, and a longer list is cut to the row', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((id) => card(id));
  assert.equal(padWithPlaceholders(five, 5).filter(isPlaceholder).length, 0);
  assert.deepEqual(padWithPlaceholders(five, 3).map((s) => (isPlaceholder(s) ? null : s.id)), ['a', 'b', 'c']);
  assert.deepEqual(padWithPlaceholders(five, 0), []);
  assert.deepEqual(padWithPlaceholders(five, -2), []);
  assert.deepEqual(padWithPlaceholders(five, Number.NaN), []);
  assert.equal(padWithPlaceholders(five, 7.9).length, 7, 'a fractional size rounds down');
});

test('only the first placeholder in a row is announced, and a placeholder names no series', () => {
  const empty = padWithPlaceholders<SeriesCard>([], FEATURED_PAGE);
  assert.equal(empty.length, FEATURED_PAGE, 'an empty catalog still fills the row');
  assert.deepEqual(empty.map((s) => isPlaceholder(s) && s.announced), [true, false, false, false, false, false, false, false]);
  const after = padWithPlaceholders([card('a')], 3).filter(isPlaceholder);
  assert.deepEqual(after.map((p) => p.announced), [true, false], 'the first placeholder after real series');
  for (const p of empty) {
    assert.deepEqual(Object.keys(p).sort(), ['announced', 'key', 'placeholder'], 'no title, genre, label or link');
  }
});

test('every storefront row of the demo catalog fills to its size, real series first', () => {
  const store = buildStorefront({
    pool: demoCards({ ranking: 'trending', limit: 60 }, false),
    picks: demoCards({ ranking: 'editorsPicks', limit: 12 }, false),
    completed: demoCards({ ranking: 'completed', limit: 12 }, false),
  });
  const rows: [string, SeriesCard[], number][] = [
    ['Weekly featured', rotatingWindow(store.featured, 0, FEATURED_PAGE), FEATURED_PAGE],
    ['Trending', store.rankings.trending, RANK_SIZE],
    ['New', store.rankings.fresh, RANK_SIZE],
    ['Completed ranking', store.rankings.completed, RANK_SIZE],
    ['New arrivals', store.arrivals, ARRIVALS_MAX],
    ['Editors’ choice', store.editors, EDITORS_MAX],
    ['Completed series', store.completed, COMPLETED_MAX],
  ];
  for (const [name, items, size] of rows) {
    const row = padWithPlaceholders(items, size);
    assert.equal(row.length, size, name);
    assert.deepEqual(realItems(row), items, `${name}: the real series are all there, first`);
    assert.equal(row.filter((s) => isPlaceholder(s) && s.announced).length, items.length < size ? 1 : 0, name);
  }
});

test('Weekly pick: the carousel whenever there is a series, the creator invitation only for an empty catalog', () => {
  assert.equal(heroMode({ loading: true, failed: false, count: 0 }), 'loading');
  assert.equal(heroMode({ loading: false, failed: false, count: 3 }), 'slides');
  assert.equal(heroMode({ loading: false, failed: false, count: 1 }), 'slides', 'one real slide, no placeholder slides');
  assert.equal(heroMode({ loading: false, failed: false, count: 0 }), 'invite');
  assert.equal(heroMode({ loading: false, failed: true, count: 0 }), 'demo', 'an unreachable catalog is not an empty one');
  assert.equal(heroMode({ loading: false, failed: true, count: 2 }), 'slides');
});

// ---- Colours -------------------------------------------------------------------------------------------

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

test('the dark footer’s text passes AA', () => {
  for (const ink of [colors.footerInk, colors.footerInkMuted]) {
    const ratio = contrast(ink, colors.footerBg);
    assert.ok(ratio >= AA, `${ink} on ${colors.footerBg}: ${ratio.toFixed(2)}:1`);
  }
});

test('ranking numbers pass AA on every surface Home puts them on', () => {
  for (const ink of [colors.accentStrong, colors.rankAmber, colors.rankTeal, colors.inkMuted]) {
    for (const bg of [colors.bg, colors.surface, colors.surfaceAlt]) {
      const ratio = contrast(ink, bg);
      assert.ok(ratio >= AA, `${ink} on ${bg}: ${ratio.toFixed(2)}:1`);
    }
  }
});

/** `top` (#RRGGBB or rgba()) laid over the opaque `bottom` at `opacity`, as #RRGGBB. */
function over(top: string, bottom: string, opacity = 1): string {
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(top);
  const t = rgba ? [rgba[1], rgba[2], rgba[3]].map(Number) : [1, 3, 5].map((i) => parseInt(top.slice(i, i + 2), 16));
  const a = (rgba ? Number(rgba[4]) : 1) * opacity;
  const b = [1, 3, 5].map((i) => parseInt(bottom.slice(i, i + 2), 16));
  return `#${t.map((v, i) => Math.round(v! * a + b[i]! * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
}

test('promo banner text passes AA, also where it runs over the decorative shapes and while hovered', () => {
  const HOVER_OPACITY = 0.92; // PromoBanners: styles.hovered
  for (const bg of [colors.bannerTeal, colors.accentStrong, colors.ai]) {
    const shaped = over(colors.bannerShape, bg);
    const cases: [string, string, string][] = [
      ['plain', colors.onAccent, bg],
      ['over a shape', colors.onAccent, shaped],
      ['hovered, over a shape', over(colors.onAccent, colors.bg, HOVER_OPACITY), over(shaped, colors.bg, HOVER_OPACITY)],
    ];
    for (const [where, ink, paper] of cases) {
      const ratio = contrast(ink, paper);
      assert.ok(ratio >= AA, `${bg} ${where}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test('the carousel dots stand out from the page (3:1 for a control)', () => {
  assert.ok(contrast(colors.inkMuted, colors.bg) >= 3);
  assert.ok(contrast(colors.accentStrong, colors.bg) >= 3);
});

test('the storefront and the footer use tokens, not raw colours', () => {
  const files = [
    'components/layout/SiteFooter.tsx',
    'features/catalog/screens/HomeScreen.tsx',
    'features/catalog/components/store/WeeklyPick.tsx',
    'features/catalog/components/store/MeetReelTale.tsx',
    'features/catalog/components/store/PosterCard.tsx',
    'features/catalog/components/store/Rankings.tsx',
    'features/catalog/components/store/NewArrivals.tsx',
    'features/catalog/components/store/PromoBanners.tsx',
    'features/catalog/components/store/SectionHeader.tsx',
    'features/catalog/components/store/TagCloud.tsx',
    'features/catalog/components/store/ComingSoon.tsx',
  ];
  for (const file of files) {
    const text = readFileSync(join(src, file), 'utf8');
    assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b|rgba?\(/i, file);
    assert.doesNotMatch(text, /https?:\/\//, `${file} names an origin`);
  }
});
