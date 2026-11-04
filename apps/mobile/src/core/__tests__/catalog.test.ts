import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EpisodePriceSchema } from '@reeltale/shared';
import { demoEpisodesOf, demoSeries, demoTags } from '../../demo/fixtures.ts';
import { resetDemoState } from '../../demo/state.ts';
import {
  DEMO_TRENDING_ORDER, demoCards, demoCatalog, demoEpisodePrice, demoFollows, demoHistory, demoIsFollowing,
  demoProgress, demoSeriesBySlug, demoSetFollow, markDemoUnlocked, recordDemoProgress,
} from '../../features/catalog/demo.ts';
import {
  applyCardQuery, browsableTags, buildHistory, buildHomeShelves, cardKey, chunk, cleanSearch, continueWatching,
  EPISODE_BRIEF_COLUMNS, EPISODE_ITEM_COLUMNS, episodeState, freeByRule, gridCardWidth, gridColumns, isAiSeries,
  isFreeAiSeries, isPermissionDenied, isRanking, mediaUrl, NEW_WINDOW_DAYS, orderFollowing, PROGRESS_COLUMNS, progressPercent,
  pickResume, RANKINGS, SERIES_CARD_COLUMNS, searchTerm, tagLabel, tagsOfSeries, titlePattern,
  type EpisodeBrief, type ProgressRow, type SeriesCard,
} from '../../features/catalog/logic.ts';
import { EPISODE_COLUMNS, SERIES_COLUMNS, TAG_COLUMNS } from '../../lib/types.ts';

const NOW = new Date('2026-10-29T12:00:00Z');
const DAY = 86_400_000;
const ctx = { tags: demoTags, matureOptIn: false, trendingOrder: DEMO_TRENDING_ORDER };

const catalog = demoCatalog(NOW);
const slugs = (list: readonly { slug: string }[]) => list.map((s) => s.slug);

function card(partial: Partial<SeriesCard> & { id: string }): SeriesCard {
  return {
    slug: partial.id, title: partial.id, cover_key: null, format: 'live_action', origin: 'creator', editors_pick: false,
    maturity: 'general', completed: false, tag_ids: [], published_at: NOW.toISOString(), ...partial,
  };
}

// ---- Pictures and search -----------------------------------------------------------------------------------

test('media keys become public URLs only when they look like keys', () => {
  const origin = 'https://media.reeltale.net';
  assert.equal(mediaUrl('public/covers/ab12.jpg', origin), 'https://media.reeltale.net/public/covers/ab12.jpg');
  assert.equal(mediaUrl('public/posters/s1/e2.jpg', `${origin}/`), 'https://media.reeltale.net/public/posters/s1/e2.jpg');
  for (const bad of [
    null, undefined, '', 'covers/a.jpg', 'private/covers/a.jpg', 'public/other/a.jpg', 'public/covers', 'public/covers/../a.jpg',
    'public/covers/./a.jpg', 'public/covers/.hidden', 'public/covers/a b.jpg', 'public/covers/a?x=1', 'public//covers/a.jpg',
    'https://evil.example/x', 'public/covers/a.jpg#frag',
  ]) {
    assert.equal(mediaUrl(bad, origin), null, String(bad));
  }
});

test('search text is cleaned, needs two characters, and LIKE characters are taken literally', () => {
  assert.equal(cleanSearch('  low \t tide \n'), 'low tide');
  assert.equal(cleanSearch('a\u0000b'), 'a b');
  assert.equal(cleanSearch('x'.repeat(200)).length, 80);
  assert.equal(searchTerm(' a '), null);
  assert.equal(searchTerm('  '), null);
  assert.equal(searchTerm(' lo '), 'lo');
  assert.equal(titlePattern('50%_off\\'), '%50\\%\\_off\\\\%');
  assert.equal(titlePattern('low tide'), '%low tide%');
});

test('a refused column is recognised by its SQLSTATE and nothing else', () => {
  assert.equal(isPermissionDenied({ code: '42501', message: 'permission denied for table series' }), true);
  assert.equal(isPermissionDenied({ code: '23505' }), false);
  assert.equal(isPermissionDenied(new Error('permission denied')), false);
  assert.equal(isPermissionDenied(null), false);
  assert.equal(isPermissionDenied('42501'), false);
});

test('a query has one key whatever order the filters were picked in', () => {
  assert.equal(
    cardKey({ ranking: 'new', formats: ['stop_motion', 'live_action'], tagIds: [5, 1], search: ' Moon  ' }),
    cardKey({ ranking: 'new', formats: ['live_action', 'stop_motion'], tagIds: [1, 5], search: 'moon' }),
  );
  assert.notEqual(cardKey({ ranking: 'new' }), cardKey({ ranking: 'trending' }));
  assert.notEqual(cardKey({ search: 'moon' }), cardKey({ search: 'moo' }));
  assert.equal(cardKey({ search: 'a' }), cardKey({}), 'a one-letter search is no search');
  assert.ok(RANKINGS.every(isRanking));
  assert.equal(isRanking('hot'), false);
  assert.equal(isRanking(undefined), false);
});

// ---- Layout --------------------------------------------------------------------------------------------------

test('the grid has two columns on phones and more on wide screens, and the cards fit the row', () => {
  assert.equal(gridColumns(360), 2);
  assert.equal(gridColumns(430), 2);
  assert.equal(gridColumns(768), 3);
  assert.equal(gridColumns(900), 4);
  assert.equal(gridColumns(1400), 5);
  for (const width of [320, 360, 390, 430, 600, 768, 840, 1024, 1100, 1280]) {
    const columns = gridColumns(width);
    const w = gridCardWidth(width, columns, 16, 12);
    assert.ok(Number.isInteger(w) && w > 80, `${width}: ${w}`);
    assert.ok(columns * w + (columns - 1) * 12 + 2 * 16 <= width, `${width}: row is wider than the screen`);
    assert.ok(width - (columns * w + (columns - 1) * 12 + 2 * 16) < columns, `${width}: rounding wastes more than a point per column`);
  }
  assert.equal(gridCardWidth(10, 2, 16, 12), 0);
});

test('chunk splits without losing or repeating anything', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1], 100), [[1]]);
});

// ---- Tags ----------------------------------------------------------------------------------------------------

test('tags: names fall back to English, browse lists skip content warnings, a series shows genres first', () => {
  const romance = demoTags.find((t) => t.slug === 'romance')!;
  assert.equal(tagLabel(romance, 'en'), 'Romance');
  assert.equal(tagLabel(romance, 'de-DE'), 'Romance');
  assert.equal(tagLabel({ ...romance, name_i18n: { en: 'Romance', de: 'Liebe' } }, 'de-DE'), 'Liebe');

  const warning = { id: 900, kind: 'warning' as const, slug: 'violence', name_i18n: { en: 'Violence' }, sort: 1 };
  const all = [...demoTags, warning];
  const { genre, trope } = browsableTags(all);
  assert.ok(genre.length > 0 && trope.length > 0);
  assert.ok(![...genre, ...trope].some((t) => t.kind === 'warning'));
  assert.deepEqual(genre.map((t) => t.sort), [...genre.map((t) => t.sort)].sort((a, b) => a - b));

  const ids = [102, 900, 1, 424242];
  const shown = tagsOfSeries(ids, all);
  assert.deepEqual(shown.map((t) => t.kind), ['genre', 'trope', 'warning']);
  assert.equal(shown.length, 3, 'an unknown tag id is skipped');
});

// ---- Home ----------------------------------------------------------------------------------------------------

test('Home shelves: Trending is the front of the list, New is recent ones by date, genres are the biggest', () => {
  const pool = demoCards({ ranking: 'trending', limit: 60 }, false).map((s) => ({ ...s }));
  const shelves = buildHomeShelves(pool, demoTags, new Date());
  assert.deepEqual(slugs(shelves.trending), slugs(pool));
  assert.ok(shelves.fresh.length > 0, 'the demo has recent series');
  assert.notDeepEqual(slugs(shelves.fresh), slugs(shelves.trending));
  const dates = shelves.fresh.map((s) => Date.parse(s.published_at ?? ''));
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  assert.ok(shelves.genres.length >= 1 && shelves.genres.length <= 3);
  for (const g of shelves.genres) {
    assert.equal(g.tag.kind, 'genre');
    assert.ok(g.items.every((s) => s.tag_ids.includes(g.tag.id)));
  }
});

test('Home leaves New out when it would repeat Trending, and keeps old series out of it', () => {
  const fresh = (id: string, daysAgo: number) => card({ id, published_at: new Date(NOW.getTime() - daysAgo * DAY).toISOString() });
  const same = buildHomeShelves([fresh('a', 1), fresh('b', 2), fresh('c', 3)], [], NOW);
  assert.equal(same.trending.length, 3);
  assert.deepEqual(same.fresh, [], 'identical to Trending');

  const mixed = buildHomeShelves([fresh('old', 90), fresh('a', 1), fresh('b', NEW_WINDOW_DAYS + 1), fresh('c', 3)], [], NOW);
  assert.deepEqual(mixed.fresh.map((s) => s.id), ['a', 'c']);

  assert.deepEqual(buildHomeShelves([], demoTags, NOW), { trending: [], fresh: [], genres: [] });
});

test('genre shelves: biggest first, at most three, the catalog order breaks ties', () => {
  const genres = [1, 2, 3, 4].map((id) => ({ id, kind: 'genre' as const, slug: `g-${id}`, name_i18n: { en: `G${id}` }, sort: id * 10 }));
  const pool = [
    card({ id: 'a', tag_ids: [1, 2] }), card({ id: 'b', tag_ids: [2] }), card({ id: 'c', tag_ids: [3] }),
    card({ id: 'd', tag_ids: [4, 2] }), card({ id: 'e', tag_ids: [] }),
  ];
  const { genres: shelves } = buildHomeShelves(pool, genres, NOW);
  assert.deepEqual(shelves.map((s) => s.tag.id), [2, 1, 3]);
  assert.deepEqual(shelves[0]?.items.map((s) => s.id), ['a', 'b', 'd']);
});

// ---- History, Continue watching, Following --------------------------------------------------------------------

const brief = (id: string, seriesId: string, number: number, duration: number | null = 100): EpisodeBrief =>
  ({ id, series_id: seriesId, number, title: `T${number}`, duration_s: duration });
const row = (episode: string, position: number, completed: boolean, hoursAgo: number): ProgressRow =>
  ({ episode_id: episode, position_s: position, completed, updated_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString() });

test('progress is a whole percentage, 100 when finished, 0 when the length is unknown', () => {
  assert.equal(progressPercent(50, 100, false), 50);
  assert.equal(progressPercent(33, 90, false), 37);
  assert.equal(progressPercent(500, 100, false), 100);
  assert.equal(progressPercent(10, 100, true), 100);
  assert.equal(progressPercent(10, null, false), 0);
  assert.equal(progressPercent(10, 0, false), 0);
  assert.equal(progressPercent(-5, 100, false), 0);
});

test('history joins progress to episodes and series, keeps the order, and drops what can no longer be seen', () => {
  const s1 = card({ id: 's1' });
  const s2 = card({ id: 's2' });
  const entries = buildHistory(
    [row('e2', 20, false, 1), row('gone', 5, false, 2), row('e1', 100, true, 3), row('orphan', 5, false, 4)],
    [brief('e1', 's1', 1), brief('e2', 's2', 4), brief('orphan', 'missing', 1)],
    [s1, s2],
  );
  assert.deepEqual(entries.map((e) => e.episode.id), ['e2', 'e1']);
  assert.deepEqual(entries.map((e) => e.percent), [20, 100]);
});

test('Continue watching: the last episode of each series, if it is not finished', () => {
  const s1 = card({ id: 's1' });
  const s2 = card({ id: 's2' });
  const s3 = card({ id: 's3' });
  const history = buildHistory(
    [row('a2', 10, false, 1), row('a1', 90, true, 2), row('b1', 100, true, 3), row('c1', 40, false, 4), row('c0', 5, false, 5)],
    [brief('a2', 's1', 2), brief('a1', 's1', 1), brief('b1', 's2', 1), brief('c1', 's3', 2), brief('c0', 's3', 1)],
    [s1, s2, s3],
  );
  assert.deepEqual(continueWatching(history, 10).map((e) => e.episode.id), ['a2', 'c1']);
  assert.deepEqual(continueWatching(history, 1).map((e) => e.episode.id), ['a2']);
  // Finishing the last episode watched ends the series' "continue" entry, even if an older episode was left unfinished.
  const finishedLast = buildHistory([row('a2', 100, true, 1), row('a1', 5, false, 2)], [brief('a2', 's1', 2), brief('a1', 's1', 1)], [s1]);
  assert.deepEqual(continueWatching(finishedLast, 10), []);
});

test('Following keeps the order the series were followed in and skips series that are no longer visible', () => {
  const series = [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })];
  const follows = [
    { series_id: 'c', created_at: '2026-10-03T00:00:00Z' },
    { series_id: 'hidden', created_at: '2026-10-02T00:00:00Z' },
    { series_id: 'a', created_at: '2026-10-01T00:00:00Z' },
  ];
  assert.deepEqual(orderFollowing(follows, series).map((s) => s.id), ['c', 'a']);
});

// ---- The series page ------------------------------------------------------------------------------------------

test('"Play" goes to the first episode, "Continue" to the one left unfinished or the next after a finished one', () => {
  const eps = [{ id: 'e3', number: 3 }, { id: 'e1', number: 1 }, { id: 'e2', number: 2 }];
  assert.equal(pickResume([], []), null);
  assert.deepEqual(pickResume(eps, []), { episodeId: 'e1', number: 1, resumed: false });
  assert.deepEqual(pickResume(eps, [row('e2', 30, false, 1)]), { episodeId: 'e2', number: 2, resumed: true });
  assert.deepEqual(pickResume(eps, [row('e1', 100, true, 5), row('e2', 100, true, 1)]), { episodeId: 'e3', number: 3, resumed: true });
  // The last episode finished: start over.
  assert.deepEqual(pickResume(eps, [row('e3', 100, true, 1)]), { episodeId: 'e1', number: 1, resumed: false });
  // Progress on episodes of other series is ignored.
  assert.deepEqual(pickResume(eps, [row('other', 30, false, 1)]), { episodeId: 'e1', number: 1, resumed: false });
  // The most recent row wins, wherever it is in the list.
  assert.deepEqual(pickResume(eps, [row('e1', 10, false, 9), row('e3', 10, false, 2), row('e2', 10, false, 7)])?.episodeId, 'e3');
});

test('an episode is free without asking the server only when it is published and inside the free ones', () => {
  const series = { status: 'published' as const, free_episode_count: 3, format: 'live_action' as const, editors_pick: false };
  assert.equal(freeByRule(series, { number: 3, is_free: false, status: 'published' }), true);
  assert.equal(freeByRule(series, { number: 4, is_free: false, status: 'published' }), false);
  assert.equal(freeByRule(series, { number: 9, is_free: true, status: 'published' }), true);
  assert.equal(freeByRule(series, { number: 1, is_free: true, status: 'closed_to_new' }), false, 'closed episodes are the server’s call');
});

test('a hidden series (kept by its buyers) has no free episodes for anyone else: the server says not_available', () => {
  // resolve_episode_price refuses every non-owner when s.status <> 'published', and playback_check follows it.
  const hidden = { status: 'hidden' as const, free_episode_count: 6, format: 'live_action' as const, editors_pick: false };
  assert.equal(freeByRule(hidden, { number: 1, is_free: false, status: 'published' }), false);
  assert.equal(freeByRule(hidden, { number: 2, is_free: true, status: 'published' }), false);
  assert.equal(isFreeAiSeries({ status: 'hidden', format: 'ai_generated', editors_pick: false }), false, 'no “Free to watch” chip');
  assert.equal(freeByRule({ ...hidden, status: 'draft' }, { number: 1, is_free: true, status: 'published' }), false, 'the creator’s own draft: the server says own');
  const sql = readFileSync(new URL('../../../../../supabase/migrations/20261027090300_ledger.sql', import.meta.url), 'utf8');
  assert.match(sql, /or s\.status <> 'published' or s\.moderation_status <> 'approved'/);
});

test('community AI stories are free, Editor’s Picks among them are priced like any series', () => {
  assert.equal(isFreeAiSeries({ status: 'published', format: 'ai_generated', editors_pick: false }), true);
  assert.equal(isFreeAiSeries({ status: 'published', format: 'ai_generated', editors_pick: true }), false);
  assert.equal(isFreeAiSeries({ status: 'published', format: 'live_action', editors_pick: false }), false);
  const ep = { number: 20, is_free: false, status: 'published' as const };
  const ai = { status: 'published' as const, free_episode_count: 3, format: 'ai_generated' as const };
  assert.equal(freeByRule({ ...ai, editors_pick: false }, ep), true);
  assert.equal(freeByRule({ ...ai, editors_pick: true }, ep), false);
  assert.equal(freeByRule({ ...ai, editors_pick: false }, { ...ep, status: 'closed_to_new' }), false);
  // The same rule as the SQL (supabase/migrations/20261027090300_ledger.sql, resolve_episode_price).
  const sql = readFileSync(new URL('../../../../../supabase/migrations/20261027090300_ledger.sql', import.meta.url), 'utf8');
  assert.match(sql, /\(s\.format = 'ai_generated' and not s\.editors_pick\)/);
});

test('what an episode row shows follows get_episode_price', () => {
  const price = (over: Record<string, unknown>) => EpisodePriceSchema.parse({
    purchasable: true, free: false, own: false, base_price: 20, discount_pct: 0, price: 20, reason: 'priced', unlocked: false, ...over,
  });
  assert.equal(episodeState(price({})), 'priced');
  assert.equal(episodeState(price({ free: true, price: 0, base_price: 0, reason: 'free' })), 'free');
  assert.equal(episodeState(price({ own: true, free: true, price: 0, reason: 'own_episode' })), 'free');
  assert.equal(episodeState(price({ unlocked: true })), 'unlocked');
  assert.equal(episodeState(price({ purchasable: false, price: 0, base_price: 0, reason: 'not_available' })), 'locked');
  assert.equal(episodeState(price({ purchasable: false, price: 0, reason: 'mature_opt_in_required' })), 'locked');
  // Closed to new unlocks, but this reader already has it.
  assert.equal(episodeState(price({ purchasable: false, price: 0, unlocked: true, reason: 'not_available' })), 'unlocked');
});

test('series made with AI are recognised by either field', () => {
  assert.equal(isAiSeries({ format: 'ai_generated', origin: 'creator' }), true);
  assert.equal(isAiSeries({ format: 'live_action', origin: 'ai_story' }), true);
  assert.equal(isAiSeries({ format: 'stop_motion', origin: 'creator' }), false);
});

// ---- The same queries in memory (demo mode) -------------------------------------------------------------------

test('the demo database filters like the real one: rankings, formats, tags, search, paging', () => {
  const run = (q: Parameters<typeof applyCardQuery>[1], opt = false) => applyCardQuery(catalog, q, { ...ctx, matureOptIn: opt });

  assert.deepEqual(slugs(run({ ranking: 'trending' })), DEMO_TRENDING_ORDER.filter((s) => s !== 'night-shift-at-the-wax-museum'));
  assert.deepEqual(slugs(run({ ranking: 'new' })), ['salt-and-static', 'low-tide', 'neon-ronin', 'the-clockmakers-mice', 'paper-moons']);
  assert.deepEqual(slugs(run({ ranking: 'completed' })), ['paper-moons']);
  assert.deepEqual(slugs(run({ ranking: 'editorsPicks' })).sort(), ['low-tide', 'the-clockmakers-mice']);
  assert.deepEqual(slugs(run({ ranking: 'aiStories' })).sort(), ['low-tide', 'neon-ronin']);
  assert.ok(run({ ranking: 'aiStories' }).every((s) => s.format === 'ai_generated'));

  assert.deepEqual(slugs(run({ formats: ['stop_motion'] })).sort(), ['paper-moons', 'the-clockmakers-mice']);
  assert.deepEqual(slugs(run({ formats: ['stop_motion', 'live_action'] })).length, 3);
  const mystery = demoTags.find((t) => t.slug === 'mystery')!;
  const sleuth = demoTags.find((t) => t.slug === 'amateur-sleuth')!;
  assert.deepEqual(slugs(run({ tagIds: [mystery.id] })), ['low-tide']);
  assert.deepEqual(slugs(run({ tagIds: [mystery.id, sleuth.id] })), ['low-tide']);
  assert.deepEqual(run({ tagIds: [mystery.id, 1] }), [], 'every picked tag has to match');

  assert.deepEqual(slugs(run({ search: 'clock' })), ['the-clockmakers-mice']);
  assert.deepEqual(slugs(run({ search: 'LIGHTHOUSE keeper' })), ['low-tide'], 'words match in any order, in the synopsis too');
  assert.deepEqual(slugs(run({ search: 'sleuth' })), ['low-tide'], 'tag names are searched');
  assert.deepEqual(run({ search: 'zzzz nothing' }), []);
  assert.equal(run({ search: 'x' }).length, run({}).length, 'one letter is no search');

  assert.equal(run({}).length, 5);
  assert.equal(run({}, true).length, 6, 'mature series show up after the opt-in');
  assert.ok(!run({}).some((s) => s.maturity === 'mature'));

  const all = slugs(run({ ranking: 'new' }));
  assert.deepEqual(slugs(run({ ranking: 'new', limit: 2 })), all.slice(0, 2));
  assert.deepEqual(slugs(run({ ranking: 'new', limit: 2, offset: 2 })), all.slice(2, 4));
  assert.deepEqual(run({ ranking: 'new', offset: 50 }), []);
});

// ---- Demo state -----------------------------------------------------------------------------------------------

test('the demo has something to show on every screen of the track, and it changes in memory only', () => {
  resetDemoState();
  const mature = demoSeries.find((s) => s.maturity === 'mature')!;
  assert.equal(demoSeriesBySlug(mature.slug, false), null);
  assert.equal(demoSeriesBySlug(mature.slug, true)?.id, mature.id);
  assert.equal(demoSeriesBySlug('no-such-series', true), null);

  // Home has a Continue watching row and Library has History and Following.
  const history = demoHistory(50, false);
  assert.ok(continueWatching(history, 10).length >= 2);
  assert.ok(history.some((e) => e.completed));
  assert.ok(history.every((e, i) => i === 0 || Date.parse(history[i - 1]!.updatedAt) >= Date.parse(e.updatedAt)));
  assert.ok(demoFollows().length >= 1);

  // Follow and unfollow.
  const target = demoSeries.find((s) => s.slug === 'low-tide')!;
  assert.equal(demoIsFollowing(target.id), false);
  demoSetFollow(target.id, true);
  assert.equal(demoFollows()[0]?.series_id, target.id, 'the newest follow comes first');
  demoSetFollow(target.id, true);
  assert.equal(demoFollows().filter((f) => f.series_id === target.id).length, 1);
  demoSetFollow(target.id, false);
  assert.equal(demoIsFollowing(target.id), false);

  // Watching moves an episode to the front of the history.
  const ep = demoEpisodesOf(target.id)[4]!;
  recordDemoProgress(ep.id, 500, false);
  assert.equal(demoProgress()[0]?.episode_id, ep.id);
  assert.equal(demoProgress()[0]?.position_s, 120, 'clamped to what the database allows');
  assert.equal(demoHistory(50, false)[0]?.episode.id, ep.id);
  resetDemoState();
  assert.ok(!demoProgress().some((p) => p.episode_id === ep.id), 'sign-out puts the fixtures back');
});

test('demo prices: the first three episodes are free, later ones cost coins, unlocking is a memory cell', () => {
  resetDemoState();
  for (const s of demoSeries) {
    const eps = demoEpisodesOf(s.id);
    eps.forEach((e) => {
      const price = demoEpisodePrice(e.id);
      assert.ok(EpisodePriceSchema.safeParse(price).success);
      if (e.number <= 3 || s.default_price_coins === null) {
        assert.equal(episodeState(price), 'free', `${s.slug} ${e.number}`);
        assert.equal(freeByRule(s, e), e.number <= 3 || e.is_free || isFreeAiSeries(s));
      } else {
        assert.equal(episodeState(price), 'priced', `${s.slug} ${e.number}`);
        assert.ok(price.price >= 10 && price.price <= 100 && price.price % 5 === 0);
      }
    });
  }
  const locked = demoEpisodesOf(demoSeries[0]!.id)[4]!;
  markDemoUnlocked(locked.id);
  markDemoUnlocked(locked.id);
  assert.equal(episodeState(demoEpisodePrice(locked.id)), 'unlocked');
  assert.equal(demoEpisodePrice('00000000-0000-4000-8000-000000000000').reason, 'not_available');
  resetDemoState();
  assert.equal(episodeState(demoEpisodePrice(locked.id)), 'priced');
});

// ---- The code stays inside the rules --------------------------------------------------------------------------

const src = fileURLToPath(new URL('../../', import.meta.url));

function files(path: string): string[] {
  const full = join(src, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

const OWN_FILES = [
  ...files('features/catalog'),
  join(src, 'app/(tabs)/index.tsx'), join(src, 'app/(tabs)/discover.tsx'), join(src, 'app/(tabs)/library.tsx'),
  join(src, 'app/series/[slug].tsx'),
].filter((f) => /\.tsx?$/.test(f));

test('the track’s files are all scanned', () => {
  assert.ok(OWN_FILES.length >= 25, `${OWN_FILES.length} files`);
});

test('queries select named columns that the migrations grant to signed-in users', () => {
  const sql = (name: string) => readFileSync(new URL(`../../../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const granted = (migration: string, table: string): Set<string> => {
    const m = new RegExp(`grant select \\(([^)]*)\\)\\s+on public\\.${table} to authenticated`, 'i').exec(migration);
    assert.ok(m, `no column grant for ${table}`);
    return new Set(m[1]!.split(',').map((c) => c.trim()));
  };
  const cols = (list: string) => list.split(',').map((c) => c.trim());
  const catalogSql = sql('20261027090200_catalog.sql');
  const accountsSql = sql('20261027090100_accounts.sql');

  const series = granted(catalogSql, 'series');
  for (const list of [SERIES_CARD_COLUMNS, SERIES_COLUMNS]) for (const c of cols(list)) assert.ok(series.has(c), `series.${c}`);
  const episodes = granted(catalogSql, 'episodes');
  for (const list of [EPISODE_ITEM_COLUMNS, EPISODE_BRIEF_COLUMNS, EPISODE_COLUMNS]) for (const c of cols(list)) assert.ok(episodes.has(c), `episodes.${c}`);
  const progress = granted(catalogSql, 'watch_progress');
  for (const c of cols(PROGRESS_COLUMNS)) assert.ok(progress.has(c), `watch_progress.${c}`);
  const follows = granted(catalogSql, 'follows');
  for (const c of ['series_id', 'created_at']) assert.ok(follows.has(c), `follows.${c}`);
  const tags = granted(catalogSql, 'tags');
  for (const c of cols(TAG_COLUMNS)) assert.ok(tags.has(c), `tags.${c}`);
  const profiles = granted(accountsSql, 'profiles');
  for (const c of ['id', 'handle', 'display_name']) assert.ok(profiles.has(c), `profiles.${c}`);

  // Search filters on the full-text column, so it must be granted (sources.ts has no title fallback any more).
  assert.ok(granted(catalogSql, 'series').has('fts'), 'series.fts must be granted for search');

  // Inserting a follow sends only series_id; progress is written by the watch track, not here.
  assert.ok(/grant insert \(series_id\) on public\.follows/i.test(catalogSql));
});

test('no query selects everything, and the client never sends a user id', () => {
  for (const file of OWN_FILES) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\.select\(\s*(['"`]\*['"`])?\s*\)/.test(text), `${file.slice(src.length)} selects *`);
  }
  const sources = readFileSync(join(src, 'features/catalog/sources.ts'), 'utf8');
  assert.ok(!/user_id/.test(sources), 'sources.ts never names user_id: RLS and column defaults supply it');
  assert.ok(!/\.(insert|upsert)\(\{[^}]*user/.test(sources));
});

test('nothing in the catalog sells anything or shows real money', () => {
  for (const file of OWN_FILES) {
    const text = readFileSync(file, 'utf8');
    const name = file.slice(src.length);
    assert.ok(!/approxPrice|formatMicros|referenceProduct|CoinProduct|RevenueCat|purchases|Intl\.NumberFormat|toLocaleString/i.test(text), `${name} deals in money`);
    assert.ok(!/[€£¥]|\$\d/.test(text), `${name} contains a currency symbol`);
    // Episode prices are in coins only: the approximate-money slot is always empty.
    if (text.includes('<CoinPrice')) assert.match(text, /approx=\{null\}/, name);
  }
});

test('series made with AI always carry the AI badge wherever a series is drawn', () => {
  // Every place that draws a series cover also draws the badge for AI series.
  const drawers = OWN_FILES.filter((f) => /<Cover\b/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(src.length + 'features/catalog/'.length));
  assert.deepEqual(drawers.sort(), [
    'components/ContinueCard.tsx', 'components/FeaturedHero.tsx', 'components/SeriesRow.tsx', 'components/SeriesTile.tsx',
    'screens/SeriesScreen.tsx', 'screens/SeriesWide.tsx',
  ]);
  for (const f of drawers) {
    const text = readFileSync(join(src, 'features/catalog', f), 'utf8');
    assert.match(text, /<AIBadge/, f);
    assert.match(text, /isAiSeries\(/, f);
  }
  assert.match(readFileSync(join(src, 'features/catalog/components/DemoStoryCard.tsx'), 'utf8'), /<AIBadge/);
});

test('a button with its own screen-reader label still names the AI and Mature badges it hides', () => {
  // On iOS, Android and the web a Pressable's accessibilityLabel replaces what its children would say.
  const read = (f: string) => readFileSync(join(src, 'features/catalog', f), 'utf8');
  assert.match(read('components/SeriesTile.tsx'), /accessibilityLabel=\{text\.a11y\}/);
  assert.match(read('components/SeriesRow.tsx'), /accessibilityLabel=\{accessibilityLabel \?\? text\.a11y\}/);
  for (const f of ['components/ContinueCard.tsx', 'screens/LibraryScreen.tsx']) {
    assert.match(read(f), /useSeriesText\(\)\([^)]*\)/, f);
    assert.match(read(f), /\.\.\.labels,?\s*\]/, `${f}: its custom label leaves the badges out`);
  }
});

test('“See all” opens Discover on just that ranking or tag, without a search left over from before', () => {
  const discover = readFileSync(join(src, 'features/catalog/screens/DiscoverScreen.tsx'), 'utf8');
  const effect = /if \(requestId === undefined\) return;([\s\S]*?)\}, \[rankingParam, tagParam, requestId\]\);/.exec(discover);
  assert.ok(effect, 'the “See all” effect moved: update this test');
  for (const reset of ['setRanking(', 'setTagIds(', 'setFormats([])', "setText('')"]) assert.ok(effect[1]!.includes(reset), reset);
});

test('demo mode makes no network requests', () => {
  for (const f of ['demo.ts']) {
    const text = readFileSync(join(src, 'features/catalog', f), 'utf8');
    assert.ok(!/https?:\/\/|fetch\(/.test(text), f);
  }
  // Only sources.ts talks to the backend, and every live call sits behind fromSource.
  for (const file of OWN_FILES) {
    const name = file.slice(src.length);
    if (name.endsWith('sources.ts')) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(!/lib\/(supabase|api)['"]|\bdb\(\)|\bsupabase\b/.test(text), `${name} reaches for the backend`);
  }
});

// ---- Strings ---------------------------------------------------------------------------------------------------

type Tree = { [key: string]: Tree | string };
const strings: Record<string, Tree> = {};
const dir = new URL('../../i18n/en/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  strings[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Tree;
}

function resolves(key: string): boolean {
  const [ns, path] = key.split(':');
  let node: Tree | string | undefined = ns ? strings[ns] : undefined;
  for (const part of (path ?? '').split('.')) {
    if (!node || typeof node === 'string') return false;
    node = node[part] ?? node[`${part}_other`];
  }
  return typeof node === 'string';
}

test('every literal string key the track uses exists', () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of OWN_FILES) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['`]([a-z]+:[A-Za-z0-9_.]+)['`]/g)) {
      const key = m[1]!;
      if (!(key.split(':')[0]! in strings)) continue;
      count += 1;
      if (!resolves(key)) missing.push(`${file.slice(src.length)}: ${key}`);
    }
  }
  assert.ok(count > 60, `only ${count} keys found: is the scan broken?`);
  assert.deepEqual(missing, []);
});

test('keys built from a value exist for every value', () => {
  for (const f of ['live_action', 'stop_motion', 'ai_generated']) assert.ok(resolves(`common:format.${f}`), f);
  for (const r of RANKINGS) assert.ok(resolves(`home:discover.rankings.${r}`), r);
  for (const tab of ['following', 'history']) assert.ok(resolves(`home:library.empty.${tab}`), tab);
  const used = OWN_FILES.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const template of ['common:format.${', 'home:discover.rankings.${', 'home:library.empty.${']) {
    assert.ok(used.includes(template), `${template} is no longer used: drop it from this test`);
  }
});

test('the plural the catalog uses has both forms', () => {
  const episode = strings.common?.episode as Tree;
  assert.ok('count_one' in episode && 'count_other' in episode);
});

test('screens and components carry no hard-coded user-facing English', () => {
  const offenders: string[] = [];
  for (const file of OWN_FILES.filter((f) => f.endsWith('.tsx'))) {
    const text = readFileSync(file, 'utf8');
    const name = file.slice(src.length);
    for (const m of text.matchAll(/(?<![=-])>\s*([A-Za-z][^<>{}\n()]*?)\s*<\//g)) offenders.push(`${name}: ${m[1]}`);
    for (const m of text.matchAll(/\b(label|title|accessibilityLabel|accessibilityHint|placeholder|alt)="([^"]+)"/g)) {
      if (m[1] === 'alt' && m[2] === '') continue;
      offenders.push(`${name}: ${m[1]}="${m[2]}"`);
    }
    for (const m of text.matchAll(/\b(label|title|accessibilityLabel|accessibilityHint|placeholder)=\{?\s*'([^']+)'/g)) offenders.push(`${name}: ${m[1]}='${m[2]}'`);
  }
  assert.deepEqual(offenders, []);
});

test('the strings the track adds are plain: curly quotes, no website or code talk, AI always called AI', () => {
  const mine = [...leaves(strings.home as Tree), ...leaves(strings.series as Tree)];
  assert.ok(mine.length > 60);
  for (const text of mine) {
    assert.ok(!/['"]/.test(text), text);
    assert.ok(!/redeem|promo|voucher|coupon|website|\bweb\b|browser|elsewhere/i.test(text), text);
  }
  assert.match((strings.home as { home: { cardMeta: string } }).home.cardMeta, /\{\{format\}\}.*\{\{status\}\}/);
});

function leaves(tree: Tree): string[] {
  return Object.values(tree).flatMap((v) => (typeof v === 'string' ? [v] : leaves(v)));
}
