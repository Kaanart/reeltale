import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, type TestDb } from './harness.ts';

let db: TestDb;
before(async () => {
  db = await freshDb({ seed: true });
});
after(async () => {
  await db.close();
});

async function creator(email: string): Promise<string> {
  const id = await db.createAdult(email);
  await db.asUser(id);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], '2026-10-27', true)`);
  return id;
}

async function newSeries(owner: string, opts: { format?: string; maturity?: string; price?: number | null } = {}) {
  await db.asUser(owner);
  const r = await db.one<{ id: string }>(
    `select public.studio_create_series($1, $2, $3, $4, 'en', 3, $5, array['romance','enemies-to-lovers']) as id`,
    ['Wrong Delivery', 'A box keeps arriving.', opts.format ?? 'live_action', opts.maturity ?? 'general', opts.price ?? null],
  );
  return r.id;
}

/** Make an episode published + approved, the way the Worker and moderation would. */
async function publishedEpisode(owner: string, series: string, price: number | null = null): Promise<string> {
  await db.asUser(owner);
  const ep = (await db.one<{ id: string }>('select public.studio_create_episode($1, $2, $3) as id', [series, 'Ep', price])).id;
  await db.asService();
  await db.q(`select svc.check_episode_upload($1, $2)`, [owner, ep]);
  await db.q(`select svc.bind_episode_upload($1, $2)`, [ep, 'asset-' + ep]);
  await db.q(`select svc.attach_episode_media($1, 'cf_stream', $2, 40, null, null)`, [ep, 'asset-' + ep]);
  await db.q(`select svc.set_moderation('episode', $1, 'approved', (select content_version from public.episodes where id = $1))`, [ep]);
  await db.asUser(owner);
  assert.equal((await db.one<{ s: string }>('select public.studio_publish_episode($1) as s', [ep])).s, 'published');
  return ep;
}

test('creating a series needs the upload-processing consent', async () => {
  const a = await db.createAdult('noconsent@example.com');
  await db.asUser(a);
  await db.fails(`select public.studio_create_series('T', 'S', 'live_action')`, [], /upload_consent_required/);
});

test('a new series starts as a pending draft with tags and a search vector', async () => {
  const c = await creator('c1@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  const row = await db.one<{ status: string; moderation_status: string; tag_ids: number[]; slug: string }>(
    'select status, moderation_status, tag_ids, slug from public.series where id = $1', [s]);
  assert.equal(row.status, 'draft');
  assert.equal(row.moderation_status, 'pending');
  assert.equal(row.tag_ids.length, 2);
  assert.match(row.slug, /^wrong-delivery-[0-9a-f]{8}$/);
  await db.asPostgres();
  const fts = await db.one<{ hit: boolean }>(
    `select fts @@ websearch_to_tsquery('simple', 'enemies lovers box') as hit from public.series where id = $1`, [s]);
  assert.equal(fts.hit, true);
});

test('unknown tags, bad formats and AI prices are rejected', async () => {
  const c = await creator('c2@example.com');
  await db.asUser(c);
  await db.fails(`select public.studio_create_series('T', 'S', 'live_action', 'general', 'en', 3, null, array['not-a-tag'])`, [], /unknown_tag/);
  await db.fails(`select public.studio_create_series('T', 'S', 'cartoon')`, [], /invalid_format/);
  await db.fails(`select public.studio_create_series('T', 'S', 'ai_generated', 'general', 'en', 3, 25)`, [], /ai_series_free_until_editors_pick/);
  await db.fails(`select public.studio_create_series('T', 'S', 'live_action', 'general', 'en', 2)`, [], /check constraint/);
  await db.fails(`select public.studio_create_series('T', 'S', 'live_action', 'general', 'en', 3, 33)`, [], /check constraint/);
});

test('creators cannot set moderation, status, origin or editor fields directly', async () => {
  const c = await creator('c3@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  await db.fails(`update public.series set moderation_status = 'approved' where id = $1`, [s], /permission denied/);
  await db.fails(`update public.series set editors_pick = true where id = $1`, [s], /permission denied/);
  await db.fails(`insert into public.series (creator_id, slug, title, format) values ($1, 'x-abc', 'x', 'live_action')`, [c], /permission denied/);
  await db.fails(`insert into public.episode_unlocks (user_id, episode_id, source) values ($1, gen_random_uuid(), 'admin')`, [c], /permission denied/);
});

test('edits before approval apply in place and keep the series pending (approved edits: moderation.test.ts)', async () => {
  const c = await creator('c4@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_series($1, 'New Title') as r`, [s])).r, 'saved');
  const r = await db.one<{ m: string; t: string }>('select moderation_status as m, title as t from public.series where id = $1', [s]);
  assert.deepEqual(r, { m: 'pending', t: 'New Title' });
});

test('other users only see published, approved series', async () => {
  const c = await creator('c5@example.com');
  const viewer = await db.createAdult('viewer5@example.com');
  const s = await newSeries(c);
  await db.asUser(viewer);
  assert.equal((await db.q('select id from public.series where id = $1', [s])).length, 0);
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  await db.asUser(viewer);
  assert.equal((await db.q('select id from public.series where id = $1', [s])).length, 0, 'still pending');
  await db.asService();
  await db.q(`select svc.set_moderation('series', $1, 'approved', (select content_version from public.series where id = $1))`, [s]);
  await db.asUser(viewer);
  assert.equal((await db.q('select id from public.series where id = $1', [s])).length, 1);
});

test('mature series need the viewer\'s opt-in', async () => {
  const c = await creator('c6@example.com');
  const viewer = await db.createAdult('viewer6@example.com');
  const s = await newSeries(c, { maturity: 'mature' });
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  await db.asService();
  await db.q(`select svc.set_moderation('series', $1, 'approved', (select content_version from public.series where id = $1))`, [s]);
  await db.asUser(viewer);
  assert.equal((await db.q('select id from public.series where id = $1', [s])).length, 0);
  await db.q('update public.profile_private set mature_opt_in = true');
  assert.equal((await db.q('select id from public.series where id = $1', [s])).length, 1);
});

test('non-adults see no catalog at all', async () => {
  const c = await creator('c7@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  await db.asService();
  await db.q(`select svc.set_moderation('series', $1, 'approved', (select content_version from public.series where id = $1))`, [s]);
  const kid = await db.createUser('kid7@example.com');
  await db.asUser(kid);
  assert.equal((await db.q('select id from public.series')).length, 0);
  assert.equal((await db.q('select id from public.tags')).length, 0);
});

test('episodes publish only after processing and approval', async () => {
  const c = await creator('c8@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  const ep = (await db.one<{ id: string }>('select public.studio_create_episode($1) as id', [s])).id;
  await db.fails('select public.studio_publish_episode($1)', [ep], /episode_not_ready/);
  await db.asService();
  await db.q(`select svc.check_episode_upload($1, $2)`, [c, ep]);
  await db.q(`select svc.bind_episode_upload($1, 'a1')`, [ep]);
  await db.q(`select svc.attach_episode_media($1, 'cf_stream', 'a1', 45, null, null)`, [ep]);
  await db.asUser(c);
  assert.equal((await db.one<{ s: string }>('select public.studio_publish_episode($1) as s', [ep])).s, 'awaiting_review');
  await db.asService();
  await db.q(`select svc.set_moderation('episode', $1, 'approved', (select content_version from public.episodes where id = $1))`, [ep]);
  await db.asUser(c);
  assert.equal((await db.one<{ s: string }>('select status as s from public.episodes where id = $1', [ep])).s, 'published');
});

test('only the owner can upload to an episode, and durations over 120 s are refused', async () => {
  const c = await creator('c9@example.com');
  const other = await creator('c9b@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  const ep = (await db.one<{ id: string }>('select public.studio_create_episode($1) as id', [s])).id;
  await db.asService();
  await db.fails(`select svc.check_episode_upload($1, $2)`, [other, ep], /upload_not_allowed/);
  await db.q(`select svc.check_episode_upload($1, $2)`, [c, ep]);
  await db.q(`select svc.bind_episode_upload($1, 'a2')`, [ep]);
  await db.fails(`select svc.attach_episode_media($1, 'cf_stream', 'a2', 121, null, null)`, [ep], /invalid_duration/);
});

test('a published episode can be closed to new unlocks but never unpublished', async () => {
  const c = await creator('c10@example.com');
  const s = await newSeries(c);
  const ep = await publishedEpisode(c, s);
  await db.asUser(c);
  await db.q('select public.studio_close_episode($1)', [ep]);
  assert.equal((await db.one<{ s: string }>('select status as s from public.episodes where id = $1', [ep])).s, 'closed_to_new');
  await db.asPostgres();
  await db.fails(`update public.episodes set status = 'draft' where id = $1`, [ep], /episode_cannot_be_unpublished/);
});

test('episode numbers count up per series and prices are validated', async () => {
  const c = await creator('c11@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  const e1 = (await db.one<{ id: string }>('select public.studio_create_episode($1) as id', [s])).id;
  const e2 = (await db.one<{ id: string }>('select public.studio_create_episode($1, $2, $3) as id', [s, 'Two', 40])).id;
  const rows = await db.q<{ id: string; number: number }>('select id, number from public.episodes where series_id = $1 order by number', [s]);
  assert.deepEqual(rows.map((r) => r.id), [e1, e2]);
  assert.deepEqual(rows.map((r) => r.number), [1, 2]);
  await db.fails('select public.studio_update_episode($1, null, $2)', [e2, 7], /check constraint/);
});

test('another creator cannot edit my series or episodes', async () => {
  const c = await creator('c12@example.com');
  const intruder = await creator('c12b@example.com');
  const s = await newSeries(c);
  await db.asUser(c);
  const ep = (await db.one<{ id: string }>('select public.studio_create_episode($1) as id', [s])).id;
  await db.asUser(intruder);
  await db.fails(`select public.studio_update_series($1, 'Hijacked')`, [s], /series_not_found/);
  await db.fails(`select public.studio_update_episode($1, 'Hijacked')`, [ep], /episode_not_found/);
  await db.fails(`select public.studio_set_series_status($1, 'hidden')`, [s], /series_not_found/);
});

test('follows and watch progress are private to their owner', async () => {
  const c = await creator('c13@example.com');
  const s = await newSeries(c);
  const ep = await publishedEpisode(c, s);
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  await db.asService();
  await db.q(`select svc.set_moderation('series', $1, 'approved', (select content_version from public.series where id = $1))`, [s]);
  const fan = await db.createAdult('fan13@example.com');
  const other = await db.createAdult('other13@example.com');
  await db.asUser(fan);
  await db.q('insert into public.follows (series_id) values ($1)', [s]);
  await db.q('insert into public.watch_progress (episode_id, position_s) values ($1, 12)', [ep]);
  await db.fails('insert into public.follows (user_id, series_id) values ($1, $2)', [other, s], /permission denied/);
  await db.asUser(other);
  assert.equal((await db.q('select * from public.follows')).length, 0);
  assert.equal((await db.q('select * from public.watch_progress')).length, 0);
});

// ---- Regression tests for the 2026-10-27 adversarial review ------------------------------------

test('review: approved media cannot be swapped by a second or late upload', async () => {
  const c = await creator('swap@example.com');
  const s = await newSeries(c);
  const ep = await publishedEpisode(c, s);
  await db.asService();
  await db.fails(`select svc.attach_episode_media($1, 'cf_stream', 'evil', 40, null, null)`, [ep], /episode_not_accepting_media/);
  await db.fails('select svc.check_episode_upload($1, $2)', [c, ep], /upload_not_allowed/);
  // While an upload is outstanding, a second upload grant is refused and unbound assets are rejected.
  await db.asUser(c);
  const ep2 = (await db.one<{ id: string }>('select public.studio_create_episode($1) as id', [s])).id;
  await db.asService();
  await db.q('select svc.check_episode_upload($1, $2)', [c, ep2]);
  await db.fails('select svc.check_episode_upload($1, $2)', [c, ep2], /upload_not_allowed/);
  await db.q(`select svc.bind_episode_upload($1, 'good')`, [ep2]);
  await db.fails(`select svc.bind_episode_upload($1, 'other')`, [ep2], /upload_not_pending/);
  await db.fails(`select svc.attach_episode_media($1, 'cf_stream', 'other', 40, null, null)`, [ep2], /episode_not_accepting_media/);
  await db.q(`select svc.attach_episode_media($1, 'cf_stream', 'good', 40, null, null)`, [ep2]);
  await db.fails(`select svc.attach_episode_media($1, 'cf_stream', 'good', 40, null, null)`, [ep2], /episode_not_accepting_media/);
});

test('review: a verdict only applies to the version that was reviewed', async () => {
  const c = await creator('stale@example.com');
  const s = await newSeries(c);
  await db.asService();
  const v = (await db.one<{ v: number }>('select content_version as v from public.series where id = $1', [s])).v;
  await db.asUser(c);
  await db.q(`select public.studio_update_series($1, 'Edited after review')`, [s]);
  await db.asService();
  assert.equal((await db.one<{ r: string }>(`select svc.set_moderation('series', $1, 'approved', $2) as r`, [s, v])).r, 'stale_verdict');
  assert.equal((await db.one<{ m: string }>('select moderation_status as m from public.series where id = $1', [s])).m, 'pending');
});

test('review: removal is final', async () => {
  const c = await creator('final@example.com');
  const s = await newSeries(c);
  const ep = await publishedEpisode(c, s);
  await db.asPostgres();
  await db.q(`update public.episodes set status = 'removed' where id = $1`, [ep]);
  await db.fails(`update public.episodes set status = 'published' where id = $1`, [ep], /episode_removed/);
  await db.q(`update public.series set status = 'removed' where id = $1`, [s]);
  await db.fails(`update public.series set status = 'published' where id = $1`, [s], /series_removed/);
});

test('review: you can only follow series you can see', async () => {
  const c = await creator('followdraft@example.com');
  const s = await newSeries(c);
  const fan = await db.createAdult('followfan@example.com');
  await db.asUser(fan);
  await db.fails('insert into public.follows (series_id) values ($1)', [s], /row-level security/);
});

test('review: a creator blocked as under 18 stops being served at once', async () => {
  const c = await creator('kidcreator@example.com');
  const s = await newSeries(c);
  await publishedEpisode(c, s);
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  await db.asService();
  await db.q(`select svc.set_moderation('series', $1, 'approved', (select content_version from public.series where id = $1))`, [s]);
  const viewer = await db.createAdult('kidviewer@example.com');
  await db.asUser(viewer);
  assert.equal((await db.q('select id from public.series where id = $1', [s])).length, 1);
  await db.asUser(c);
  await db.q('select public.report_underage_signal()');
  await db.asUser(viewer);
  assert.equal((await db.q('select id from public.series where id = $1', [s])).length, 0);
});
