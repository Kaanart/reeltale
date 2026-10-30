// EpisodeIngest: the per-creator upload cap, the deletion queue for replaced Stream videos, and the
// service RPCs the ingest workflow calls (context, review claim with the daily cap, poster keys).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, type TestDb } from './harness.ts';

let db: TestDb;
before(async () => {
  db = await freshDb({ seed: true });
});
after(async () => {
  await db.close();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
/** A Stream-style video uid (32 hex characters). */
const newAsset = () => randomUUID().replace(/-/g, '');

async function creator(): Promise<string> {
  const id = await db.createAdult(`ingest-${uniq()}@example.com`);
  await db.asUser(id);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], 'v1', true)`);
  return id;
}

async function newSeries(owner: string, maturity = 'general'): Promise<string> {
  await db.asUser(owner);
  return (await db.one<{ id: string }>(
    `select public.studio_create_series('Wrong Delivery', 'A box keeps arriving.', 'live_action', $1, 'en', 3, null, array['romance']) as id`,
    [maturity])).id;
}

async function newEpisode(owner: string, s: string, title = 'Ep'): Promise<string> {
  await db.asUser(owner);
  return (await db.one<{ id: string }>('select public.studio_create_episode($1, $2) as id', [s, title])).id;
}

/** Start, bind and attach one upload, the way the Worker and the Stream webhook do. */
async function upload(owner: string, ep: string, asset = newAsset()): Promise<string> {
  await db.asService();
  await db.q('select svc.check_episode_upload($1, $2)', [owner, ep]);
  await db.q('select svc.bind_episode_upload($1, $2)', [ep, asset]);
  await db.q(`select svc.attach_episode_media($1, 'cf_stream', $2, 45, null, null)`, [ep, asset]);
  return asset;
}

async function setCfg(key: string, value: string) {
  await db.asPostgres();
  await db.q('update public.pricing_config set value = $2::jsonb where key = $1', [key, value]);
}

async function version(ep: string): Promise<number> {
  await db.asPostgres();
  return (await db.one<{ v: number }>('select content_version as v from public.episodes where id = $1', [ep])).v;
}

async function verdict(ep: string, decision: string, v: number): Promise<string> {
  await db.asService();
  return (await db.one<{ r: string }>(
    `select svc.record_verdict('episode', $1, $2, 'auto', 'muse-spark-1.3', $3, '{}', 'test', null) as r`, [ep, v, decision])).r;
}

async function due(ep: string | null): Promise<string[]> {
  await db.asService();
  return (await db.one<{ a: string[] }>('select svc.stream_cleanup_due($1, 50) as a', [ep])).a;
}

async function claim(ep: string, asset: string, v: number): Promise<string> {
  await db.asService();
  return (await db.one<{ r: string }>('select svc.ingest_claim_review($1, $2, $3) as r', [ep, asset, v])).r;
}

async function reviewsToday(): Promise<number> {
  await db.asPostgres();
  const rows = await db.q<{ n: number }>(
    `select reviews as n from app_private.ingest_review_daily where day = (now() at time zone 'utc')::date`);
  return rows[0]?.n ?? 0;
}

test('a creator can start at most uploads_per_day uploads a day; refused starts do not count', async () => {
  await setCfg('uploads_per_day', '2');
  try {
    const c = await creator();
    const other = await creator();
    const s = await newSeries(c);
    const [e1, e2, e3] = [await newEpisode(c, s), await newEpisode(c, s), await newEpisode(c, s)];
    await db.asService();
    await db.fails('select svc.check_episode_upload($1, $2)', [other, e1], /upload_not_allowed/);
    await db.q('select svc.check_episode_upload($1, $2)', [c, e1]);
    await db.fails('select svc.check_episode_upload($1, $2)', [c, e1], /upload_not_allowed/);  // grant still live
    await db.q('select svc.check_episode_upload($1, $2)', [c, e2]);
    await db.fails('select svc.check_episode_upload($1, $2)', [c, e3], /rate_limited/);
    await db.asPostgres();
    assert.equal((await db.one<{ s: string }>('select status as s from public.episodes where id = $1', [e3])).s, 'draft',
      'a refused start changes nothing');

    // Another creator has their own allowance.
    const otherEp = await newEpisode(other, await newSeries(other));
    await db.asService();
    await db.q('select svc.check_episode_upload($1, $2)', [other, otherEp]);

    // A day later the old starts no longer count, and they are pruned: everyone's, so a creator who
    // never uploads again (or deleted their account) doesn't stay in the table.
    await db.asPostgres();
    await db.q(`update app_private.upload_starts set created_at = now() - interval '25 hours' where user_id in ($1, $2)`, [c, other]);
    await db.asService();
    await db.q('select svc.check_episode_upload($1, $2)', [c, e3]);
    await db.asPostgres();
    assert.equal((await db.one<{ n: number }>('select count(*)::int as n from app_private.upload_starts where user_id = $1', [c])).n, 1);
    assert.equal((await db.one<{ n: number }>('select count(*)::int as n from app_private.upload_starts where user_id = $1', [other])).n, 0);
  } finally {
    await setCfg('uploads_per_day', '30');
  }
});

test('a replaced or superseded Stream video is queued for deletion; a video in use never is', async () => {
  const c = await creator();
  const s = await newSeries(c);
  const ep = await newEpisode(c, s);
  const a = await upload(c, ep);
  assert.deepEqual(await due(ep), []);

  // Rejected media can be replaced by a new upload: the old video is queued when the new one attaches.
  assert.equal(await verdict(ep, 'rejected', await version(ep)), 'applied');
  const b = await upload(c, ep);
  assert.deepEqual(await due(ep), [a]);

  // An upload grant that expired (and might have been used) is superseded by a new grant.
  assert.equal(await verdict(ep, 'rejected', await version(ep)), 'applied');
  await db.asService();
  await db.q('select svc.check_episode_upload($1, $2)', [c, ep]);
  const expired = newAsset();
  await db.q('select svc.bind_episode_upload($1, $2)', [ep, expired]);
  await db.asPostgres();
  await db.q(`update app_private.episode_media set pending_upload_at = now() - interval '3 hours' where episode_id = $1`, [ep]);
  const d = await upload(c, ep);
  await db.asPostgres();
  const rows = await db.q<{ asset_id: string; reason: string }>(
    'select asset_id, reason from app_private.stream_cleanup where episode_id = $1 order by asset_id', [ep]);
  const want = [{ asset_id: a, reason: 'replaced' }, { asset_id: expired, reason: 'superseded' }, { asset_id: b, reason: 'replaced' }];
  assert.deepEqual(rows, want.sort((x, y) => x.asset_id.localeCompare(y.asset_id)));
  assert.deepEqual((await due(ep)).sort(), [a, expired, b].sort());
  assert.ok((await due(null)).includes(a), 'a sweep sees every episode');
  assert.deepEqual(await due(await newEpisode(c, s)), []);

  // Never the current video, even if it somehow got into the queue; and a hold delays deletion.
  await db.asPostgres();
  await db.q(`select app_private.queue_stream_cleanup($1, $2, 'replaced')`, [ep, d]);
  assert.ok(!(await due(ep)).includes(d));
  await setCfg('replaced_media_hold_hours', '24');
  const held = newAsset();
  await db.asPostgres();
  await db.q(`select app_private.queue_stream_cleanup($1, $2, 'replaced')`, [ep, held]);
  await setCfg('replaced_media_hold_hours', '0');
  assert.ok(!(await due(ep)).includes(held), 'not due before the hold ends');

  await db.asService();
  assert.equal((await db.one<{ n: number }>('select svc.stream_cleanup_done($1) as n', [[a, expired]])).n, 2);
  assert.equal((await db.one<{ n: number }>('select svc.stream_cleanup_done($1) as n', [[a, expired]])).n, 0, 'idempotent');
  assert.deepEqual(await due(ep), [b]);
});

test('attach keeps its checks: a refused upload attaches nothing and queues nothing', async () => {
  const c = await creator();
  const s = await newSeries(c);
  const ep = await newEpisode(c, s);
  const a = await upload(c, ep);
  await db.asService();
  await db.fails(`select svc.attach_episode_media($1, 'cf_stream', $2, 45, null, null)`, [ep, a], /episode_not_accepting_media/);
  await db.fails(`select svc.attach_episode_media($1, 'cf_stream', $2, 45, null, null)`, [ep, newAsset()], /episode_not_accepting_media/);
  await db.fails(`select svc.attach_episode_media($1, 'cf_stream', $2, 0, null, null)`, [ep, a], /invalid_duration/);
  await db.asPostgres();
  assert.equal((await db.one<{ a: string }>('select asset_id as a from app_private.episode_media where episode_id = $1', [ep])).a, a);
  assert.equal((await db.q('select 1 from app_private.stream_cleanup where episode_id = $1', [ep])).length, 0);
});

test('ingest_context describes the episode, its media and its series; null for an unknown episode', async () => {
  const c = await creator();
  const s = await newSeries(c, 'mature');
  const ep = await newEpisode(c, s, 'Pilot');
  const a = await upload(c, ep);
  const v = await version(ep);
  await db.asService();
  const ctx = async () => (await db.one<{ c: Record<string, unknown> | null }>('select svc.ingest_context($1) as c', [ep])).c;
  assert.deepEqual(await ctx(), {
    episode_id: ep, content_version: v, title: 'Pilot', duration_s: 45, status: 'ready', moderation_status: 'pending',
    provider: 'cf_stream', asset_id: a, awaiting_editor: false,
    series: { title: 'Wrong Delivery', synopsis: 'A box keeps arriving.', maturity: 'mature', format: 'live_action', language: 'en' },
  });
  assert.equal(await verdict(ep, 'needs_editor', v), 'held');
  await db.asService();
  assert.equal((await ctx())!.awaiting_editor, true);
  assert.equal((await db.one<{ c: unknown }>('select svc.ingest_context($1) as c', [randomUUID()])).c, null);
});

test('one paid review per version of the current upload, within the platform-wide daily cap', async () => {
  const base = await reviewsToday();
  await setCfg('ingest_reviews_per_day', String(base + 2));
  try {
    const c = await creator();
    const s = await newSeries(c);
    const ep = await newEpisode(c, s);
    const a = await upload(c, ep);
    const v1 = await version(ep);
    assert.equal(await claim(ep, a, v1), 'ok');
    assert.equal(await claim(ep, a, v1), 'ok', 'a retried step re-uses its claim');
    assert.equal(await reviewsToday(), base + 1);
    assert.equal(await claim(ep, newAsset(), v1), 'stale', 'not the current upload');
    assert.equal(await claim(ep, a, v1 + 1), 'stale', 'not the current version');

    // A title change before approval is a new version: it needs (and gets) its own review.
    await db.asPostgres();
    await db.q(`update public.episodes set title = 'Pilot (final)' where id = $1`, [ep]);
    const v2 = await version(ep);
    assert.equal(v2, v1 + 1);
    assert.equal(await claim(ep, a, v1), 'stale');
    assert.equal(await claim(ep, a, v2), 'ok');
    assert.equal(await reviewsToday(), base + 2);

    // Over the cap: no claim, nothing counted.
    const ep2 = await newEpisode(c, s);
    const b = await upload(c, ep2);
    assert.equal(await claim(ep2, b, await version(ep2)), 'over_cap');
    assert.equal(await reviewsToday(), base + 2);
    await db.asPostgres();
    assert.equal((await db.q('select 1 from app_private.ingest_reviews where episode_id = $1', [ep2])).length, 0);

    // A version with a verdict is never reviewed again; a decided episode is stale.
    assert.equal(await verdict(ep, 'needs_editor', v2), 'held');
    assert.equal(await claim(ep, a, v2), 'reviewed');
    assert.equal(await verdict(ep, 'approved', v2), 'applied');
    assert.equal(await claim(ep, a, v2), 'stale');
  } finally {
    await setCfg('ingest_reviews_per_day', '500');
  }
});

test('poster and preview keys are only set for approved media that is still current, under keys for that upload', async () => {
  const c = await creator();
  const s = await newSeries(c);
  const ep = await newEpisode(c, s);
  const a = await upload(c, ep);
  const poster = `public/posters/${ep}/${a}.jpg`;
  const preview = `public/previews/${ep}/${a}.gif`;
  const set = async (asset: string, p: string | null, pv: string | null) => {
    await db.asService();
    return (await db.one<{ ok: boolean }>('select svc.ingest_set_media($1, $2, $3, $4) as ok', [ep, asset, p, pv])).ok;
  };
  const keys = async () => {
    await db.asPostgres();
    return db.one('select poster_key, preview_key from public.episodes where id = $1', [ep]);
  };
  assert.equal(await set(a, poster, preview), false, 'not before approval');
  assert.deepEqual(await keys(), { poster_key: null, preview_key: null });

  assert.equal(await verdict(ep, 'approved', await version(ep)), 'applied');
  const other = newAsset();
  assert.equal(await set(other, `public/posters/${ep}/${other}.jpg`, null), false, 'not for another upload');
  await db.asService();
  for (const [p, pv] of [
    [`public/posters/${ep}/${other}.jpg`, null],             // key of another upload
    [`public/posters/${randomUUID()}/${a}.jpg`, null],        // key of another episode
    [`public/covers/${ep}/${a}.jpg`, null],                   // wrong prefix
    [poster, `public/posters/${ep}/${a}.gif`],                // preview under the poster prefix
    [null, preview],                                          // no poster
  ] as [string | null, string | null][]) {
    await db.fails('select svc.ingest_set_media($1, $2, $3, $4)', [ep, a, p, pv], /invalid_media_key/);
  }
  assert.equal(await set(a, poster, null), true);
  assert.deepEqual(await keys(), { poster_key: poster, preview_key: null });
  assert.equal(await set(a, poster, preview), true);
  assert.deepEqual(await keys(), { poster_key: poster, preview_key: preview });
  await db.asUser(c);
  assert.deepEqual(await db.one('select poster_key, preview_key from public.episodes where id = $1', [ep]),
    { poster_key: poster, preview_key: preview }, 'the owner sees them');

  await db.asPostgres();
  await db.q(`update public.episodes set status = 'removed' where id = $1`, [ep]);
  assert.equal(await set(a, poster, null), false, 'not for removed episodes');
});

test('the ingest functions are executable by the service role only', async () => {
  const fns = [
    'svc.ingest_context(uuid)',
    'svc.ingest_claim_review(uuid, text, integer)',
    'svc.ingest_set_media(uuid, text, text, text)',
    'svc.stream_cleanup_due(uuid, integer)',
    'svc.stream_cleanup_done(text[])',
    'svc.check_episode_upload(uuid, uuid)',
    'svc.attach_episode_media(uuid, text, text, integer, text, text, text)',
  ];
  await db.asPostgres();
  for (const f of fns) {
    const r = await db.one<{ anon: boolean; auth: boolean; svc: boolean; definer: boolean; cfg: string[] }>(
      `select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as svc,
              p.prosecdef as definer, p.proconfig as cfg
       from pg_proc p where p.oid = $1::regprocedure`, [f]);
    assert.deepEqual({ anon: r.anon, auth: r.auth, svc: r.svc, definer: r.definer }, { anon: false, auth: false, svc: true, definer: true }, f);
    assert.ok(r.cfg.some((x) => x === 'search_path=""' || x === "search_path=''"), f);
  }
  const helper = await db.one<{ auth: boolean; svc: boolean }>(
    `select has_function_privilege('authenticated', 'app_private.queue_stream_cleanup(uuid, text, text)'::regprocedure, 'EXECUTE') as auth,
            has_function_privilege('service_role', 'app_private.queue_stream_cleanup(uuid, text, text)'::regprocedure, 'EXECUTE') as svc`);
  assert.deepEqual(helper, { auth: false, svc: false });

  // And a signed-in user (or anon) calling them is refused outright.
  const user = await creator();
  const ep = randomUUID();
  const calls: [string, unknown[]][] = [
    ['select svc.ingest_context($1)', [ep]],
    ['select svc.ingest_claim_review($1, $2, 1)', [ep, newAsset()]],
    ['select svc.ingest_set_media($1, $2, $3, null)', [ep, 'x', `public/posters/${ep}/x.jpg`]],
    ['select svc.stream_cleanup_due(null, 10)', []],
    ['select svc.stream_cleanup_done($1)', [['x']]],
  ];
  for (const [sql, params] of calls) {
    await db.asUser(user);
    await db.fails(sql, params, /permission denied/);
    await db.asAnon();
    await db.fails(sql, params, /permission denied/);
  }
  // None of the new tables is reachable by client roles or the service role directly.
  for (const t of ['upload_starts', 'ingest_reviews', 'ingest_review_daily', 'stream_cleanup']) {
    await db.asService();
    await db.fails(`select * from app_private.${t}`, [], /permission denied/);
    await db.asUser(user);
    await db.fails(`select * from app_private.${t}`, [], /permission denied/);
  }
  await db.asPostgres();
});
