// Moderation of series and episodes: first reviews, pending edits of approved content, takedowns.
// Regressions for the second DB review (prep/reviews/db-fix-verification-2026-10-27.json).
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

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function creator(): Promise<string> {
  const id = await db.createAdult(`mod-${uniq()}@example.com`);
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

async function version(table: 'series' | 'episodes', id: string): Promise<number> {
  await db.asPostgres();
  return (await db.one<{ v: number }>(`select content_version as v from public.${table} where id = $1`, [id])).v;
}

async function verdict(target: string, id: string, status: string, v: number): Promise<string> {
  await db.asService();
  return (await db.one<{ r: string }>('select svc.set_moderation($1, $2, $3, $4) as r', [target, id, status, v])).r;
}

const approveSeries = async (s: string) => assert.equal(await verdict('series', s, 'approved', await version('series', s)), 'applied');

/** An episode whose media is attached (ready, pending review). */
async function mediaEpisode(owner: string, s: string, title = 'Ep'): Promise<string> {
  await db.asUser(owner);
  const ep = (await db.one<{ id: string }>('select public.studio_create_episode($1, $2) as id', [s, title])).id;
  await upload(owner, ep);
  return ep;
}

async function upload(owner: string, ep: string) {
  await db.asService();
  const asset = `asset-${uniq()}`;
  await db.q('select svc.check_episode_upload($1, $2)', [owner, ep]);
  await db.q('select svc.bind_episode_upload($1, $2)', [ep, asset]);
  await db.q(`select svc.attach_episode_media($1, 'cf_stream', $2, 45, null, null)`, [ep, asset]);
}

async function publishedEpisode(owner: string, s: string): Promise<string> {
  const ep = await mediaEpisode(owner, s);
  assert.equal(await verdict('episode', ep, 'approved', await version('episodes', ep)), 'applied');
  await db.asUser(owner);
  assert.equal((await db.one<{ s: string }>('select public.studio_publish_episode($1) as s', [ep])).s, 'published');
  return ep;
}

async function playback(user: string, ep: string) {
  await db.asService();
  return (await db.one<{ r: { allowed: boolean; reason: string } }>('select svc.playback_check($1, $2) as r', [user, ep])).r;
}

async function edit(target: 'series' | 'episode', id: string) {
  await db.asPostgres();
  return db.q<{ fields: Record<string, unknown>; status: string; version: number }>(
    'select fields, status, version from public.pending_edits where target = $1 and target_id = $2', [target, id]);
}

test('edits to an approved series wait for review; everyone else keeps seeing the approved text', async () => {
  const c = await creator();
  const s = await newSeries(c);
  await approveSeries(s);
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  const viewer = await db.createAdult(`viewer-${uniq()}@example.com`);

  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_series($1, 'Visit scam.example', 'Free coins at scam.example') as r`, [s])).r,
    'awaiting_review');
  await db.asUser(viewer);
  assert.deepEqual(await db.one('select title, synopsis from public.series where id = $1', [s]),
    { title: 'Wrong Delivery', synopsis: 'A box keeps arriving.' });
  assert.equal((await db.q('select 1 from public.pending_edits')).length, 0, 'edits are owner-only');
  await db.asUser(c);
  const mine = await db.one<{ fields: object; status: string }>('select fields, status from public.pending_edits where target_id = $1', [s]);
  assert.deepEqual(mine, { fields: { title: 'Visit scam.example', synopsis: 'Free coins at scam.example' }, status: 'pending' });
  const queued = async () => {
    await db.asService();
    const q = (await db.one<{ q: { target: string; id: string; version: number }[] }>('select svc.moderation_queue(500) as q')).q;
    return q.some((i) => i.target === 'series_edit' && i.id === s && i.version === 1);
  };
  assert.equal(await queued(), false, 'an edit waits a minute (the creator may still be typing)');
  await db.asPostgres();
  await db.q(`update public.pending_edits set updated_at = now() - interval '2 minutes' where target_id = $1`, [s]);
  assert.equal(await queued(), true);

  // Rejected: the edit is marked, the series is untouched.
  assert.equal(await verdict('series_edit', s, 'rejected', 1), 'applied');
  assert.equal((await edit('series', s))[0]?.status, 'rejected');
  await db.asUser(viewer);
  assert.equal((await db.one<{ m: string }>('select moderation_status as m from public.series where id = $1', [s])).m, 'approved');

  // A new edit starts fresh (rejected fields aren't carried) and needs its own version approved.
  await db.asUser(c);
  await db.q(`select public.studio_update_series($1, 'Wrong Delivery: Return to Sender')`, [s]);
  assert.deepEqual((await edit('series', s))[0], { fields: { title: 'Wrong Delivery: Return to Sender' }, status: 'pending', version: 2 });
  assert.equal(await verdict('series_edit', s, 'approved', 1), 'stale_verdict');
  assert.equal(await verdict('series_edit', s, 'approved', 2), 'applied');
  await db.asUser(viewer);
  assert.equal((await db.one<{ t: string }>('select title as t from public.series where id = $1', [s])).t, 'Wrong Delivery: Return to Sender');
  assert.equal((await edit('series', s)).length, 0);

  // Saving the approved value again, or only unreviewed fields, creates no edit.
  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_series($1, 'Wrong Delivery: Return to Sender') as r`, [s])).r, 'saved');
  assert.equal((await db.one<{ r: string }>('select public.studio_update_series($1, null, null, null, null, null, false, true) as r', [s])).r, 'saved');
  assert.equal((await edit('series', s)).length, 0);
});

test('tag changes and a mature → general change wait for review; general → mature applies at once', async () => {
  const c = await creator();
  const s = await newSeries(c, 'mature');
  await approveSeries(s);
  await db.asUser(c);
  await db.q(`select public.studio_update_series($1, p_maturity => 'general', p_tag_slugs => array['comedy'])`, [s]);
  const live = async () => {
    await db.asPostgres();
    return db.one<{ maturity: string; tags: string[] }>(
      'select maturity, app_private.series_tag_slugs(id) as tags from public.series where id = $1', [s]);
  };
  assert.deepEqual(await live(), { maturity: 'mature', tags: ['romance'] });
  assert.equal(await verdict('series_edit', s, 'approved', 1), 'applied');
  assert.deepEqual(await live(), { maturity: 'general', tags: ['comedy'] });
  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_series($1, p_maturity => 'mature') as r`, [s])).r, 'saved');
  assert.equal((await live()).maturity, 'mature');
});

test('approved fields cannot be changed in place, not even by a direct update', async () => {
  const c = await creator();
  const s = await newSeries(c);
  await approveSeries(s);
  const ep = await publishedEpisode(c, s);
  await db.asPostgres();
  await db.fails(`update public.series set title = 'Sneaky' where id = $1`, [s], /edit_requires_review/);
  await db.fails(`update public.episodes set title = 'Sneaky' where id = $1`, [ep], /edit_requires_review/);
  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_episode($1, 'Better title') as r`, [ep])).r, 'awaiting_review');
  assert.equal(await verdict('episode_edit', ep, 'approved', 1), 'applied');
  await db.asPostgres();
  assert.equal((await db.one<{ t: string }>('select title as t from public.episodes where id = $1', [ep])).t, 'Better title');
});

test('a rejection sticks: a title edit never un-rejects media, which is never served again; a new upload resubmits', async () => {
  const c = await creator();
  const s = await newSeries(c);
  await approveSeries(s);
  const ep = await mediaEpisode(c, s);
  assert.equal(await verdict('episode', ep, 'rejected', await version('episodes', ep)), 'applied');
  assert.equal((await playback(c, ep)).reason, 'not_available');
  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_episode($1, 'harmless new title') as r`, [ep])).r, 'saved');
  await db.asPostgres();
  assert.equal((await db.one<{ m: string }>('select moderation_status as m from public.episodes where id = $1', [ep])).m, 'rejected');
  assert.equal((await playback(c, ep)).reason, 'not_available');
  await db.asUser(c);
  await db.fails('select public.studio_publish_episode($1)', [ep], /episode_rejected/);

  await upload(c, ep);
  await db.asPostgres();
  assert.equal((await db.one<{ m: string }>('select moderation_status as m from public.episodes where id = $1', [ep])).m, 'pending');
  assert.equal((await playback(c, ep)).reason, 'own', 'the creator can preview the new upload');
});

test('first reviews: approvals need the exact version (and media); rejections also apply to newer versions', async () => {
  const c = await creator();
  const s = await newSeries(c);
  const v0 = await version('series', s);
  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_series($1, 'Edited before review') as r`, [s])).r, 'saved');
  assert.equal(await verdict('series', s, 'approved', v0), 'stale_verdict');
  assert.equal(await verdict('series', s, 'rejected', v0), 'applied', 'rejecting is the safe direction');
  // A series that was never public can be fixed and resubmitted.
  await db.asUser(c);
  await db.q(`select public.studio_update_series($1, 'Fixed title')`, [s]);
  await db.asPostgres();
  assert.equal((await db.one<{ m: string }>('select moderation_status as m from public.series where id = $1', [s])).m, 'pending');
  await approveSeries(s);
  assert.equal(await verdict('series', s, 'rejected', await version('series', s)), 'not_applicable', 'takedowns are removals');

  await db.asUser(c);
  const ep = (await db.one<{ id: string }>('select public.studio_create_episode($1, $2) as id', [s, 'Draft'])).id;
  assert.equal(await verdict('episode', ep, 'approved', await version('episodes', ep)), 'stale_verdict', 'no media yet');
  await upload(c, ep);
  const v1 = await version('episodes', ep);
  await db.asUser(c);
  assert.equal((await db.one<{ s: string }>('select public.studio_publish_episode($1) as s', [ep])).s, 'awaiting_review');
  await db.q(`select public.studio_update_episode($1, 'Renamed during review')`, [ep]);
  assert.equal(await verdict('episode', ep, 'approved', v1), 'stale_verdict');
  assert.equal(await verdict('episode', ep, 'approved', v1 + 1), 'applied');
  await db.asPostgres();
  assert.equal((await db.one<{ s: string }>('select status as s from public.episodes where id = $1', [ep])).s, 'published');
  await db.asService();
  const queue = (await db.one<{ q: { id: string }[] }>('select svc.moderation_queue(500) as q')).q;
  assert.ok(!queue.some((i) => i.id === ep || i.id === s), 'reviewed items leave the queue');
});

// ---- buyers ----------------------------------------------------------------------------------

async function sellingSeries() {
  const c = await creator();
  const s = await newSeries(c);
  await approveSeries(s);
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  const eps: string[] = [];
  for (let i = 0; i < 5; i++) eps.push(await publishedEpisode(c, s));
  await db.asService();
  await db.q(`select svc.set_creator_status($1, 'active', '2026-10-27')`, [c]);
  return { c, s, eps };
}

async function buyer(): Promise<string> {
  const u = await db.createAdult(`buyer-${uniq()}@example.com`);
  await db.asService();
  await db.q(`select svc.credit_purchase($1, $2, 'app_store', $3, 'reeltale.coins.100', 'production', 700000)`, [u, `e-${uniq()}`, `t-${uniq()}`]);
  return u;
}

async function balance(u: string): Promise<number> {
  await db.asUser(u);
  return (await db.one<{ w: { balance: number } }>('select public.get_my_wallet() as w')).w.balance;
}

async function unlock(u: string, ep: string) {
  await db.asUser(u);
  await db.q('select public.unlock_episode($1, 25)', [ep]);
}

test('a rejected edit takes nothing away from buyers', async () => {
  const { c, s, eps } = await sellingSeries();
  const u = await buyer();
  await unlock(u, eps[3]!);
  await db.asUser(c);
  await db.q(`select public.studio_update_series($1, 'Obviously bad title', 'Obviously bad synopsis')`, [s]);
  await db.q(`select public.studio_update_episode($1, 'Obviously bad episode title')`, [eps[3]]);
  assert.equal(await verdict('series_edit', s, 'rejected', 1), 'applied');
  assert.equal(await verdict('episode_edit', eps[3]!, 'rejected', 1), 'applied');
  assert.equal((await playback(u, eps[3]!)).reason, 'unlocked');
  await db.asUser(u);
  assert.equal((await db.one<{ t: string }>('select title as t from public.series where id = $1', [s])).t, 'Wrong Delivery');
  assert.equal((await db.one<{ t: string }>('select title as t from public.episodes where id = $1', [eps[3]])).t, 'Ep');
  assert.equal(await balance(u), 75);
});

test('removing a series takes it all down and re-credits buyers in pages', async () => {
  const { c, s, eps } = await sellingSeries();
  const a = await buyer();
  const b = await buyer();
  await unlock(a, eps[3]!);
  await unlock(b, eps[3]!);
  await unlock(a, eps[4]!);
  await db.asService();
  const todo = (await db.one<{ r: string[] }>('select svc.remove_series($1) as r', [s])).r;
  assert.deepEqual([...todo].sort(), [eps[3], eps[4]].sort());
  const page = async (ep: string) => (await db.one<{ n: number }>(`select svc.recredit_episode($1, 'moderation', 1) as n`, [ep])).n;
  assert.deepEqual([await page(eps[3]!), await page(eps[3]!), await page(eps[3]!)], [1, 1, 0]);
  assert.deepEqual([await page(eps[4]!), await page(eps[4]!)], [1, 0]);
  assert.deepEqual([await balance(a), await balance(b)], [100, 100]);
  await db.asUser(a);
  assert.equal((await db.q('select 1 from public.series where id = $1', [s])).length, 0);
  assert.equal((await playback(a, eps[3]!)).reason, 'not_available');
  await db.asUser(c);
  await db.fails(`select public.studio_update_series($1, 'Back again')`, [s], /series_removed/);
  assert.ok((await db.q<{ status: string }>('select status from public.earnings where episode_id = any ($1)', [[eps[3], eps[4]]]))
    .every((e) => e.status === 'void'));
});

// ---- verdict log -------------------------------------------------------------------------------

async function record(target: string, id: string, v: number, decision: string, source = 'auto', editor: string | null = null) {
  await db.asService();
  return (await db.one<{ r: string }>(
    `select svc.record_verdict($1, $2, $3, $4, 'muse-spark-1.3', $5, array['spam'], 'reason', $6) as r`,
    [target, id, v, source, decision, editor])).r;
}

test('verdicts are logged and applied; "needs_editor" moves an item to the editor queue', async () => {
  const c = await creator();
  const s = await newSeries(c);
  const v = await version('series', s);
  const queue = async (forEditor: boolean) => {
    await db.asService();
    return (await db.one<{ q: { id: string }[] }>('select svc.moderation_queue(500, null, $1) as q', [forEditor])).q.some((i) => i.id === s);
  };
  assert.deepEqual([await queue(false), await queue(true)], [true, false]);
  assert.equal(await record('series', s, v, 'needs_editor'), 'held');
  assert.deepEqual([await queue(false), await queue(true)], [false, true]);
  await db.fails(`select svc.record_verdict('series', $1, $2, 'editor', null, 'approved', null, null, $3)`, [s, v, c], /not_an_editor/);
  const editor = await db.createAdult(`editor-${uniq()}@example.com`);
  await db.asPostgres();
  await db.q(`update public.profiles set role = 'editor' where id = $1`, [editor]);
  assert.equal(await record('series', s, v, 'approved', 'editor', editor), 'applied');
  assert.deepEqual([await queue(false), await queue(true)], [false, false]);
  await db.asPostgres();
  const log = await db.q<{ decision: string; outcome: string; source: string }>(
    'select decision, outcome, source from app_private.moderation_verdicts where target_id = $1 order by id', [s]);
  assert.deepEqual(log, [{ decision: 'needs_editor', outcome: 'held', source: 'auto' }, { decision: 'approved', outcome: 'applied', source: 'editor' }]);
  await db.fails('update app_private.moderation_verdicts set decision = $1 where target_id = $2', ['rejected', s], /append-only|not allowed|forbid/i);
  await db.asUser(c);
  await db.fails('select svc.record_verdict($1, $2, $3, $4, null, $5, null, null)', ['series', s, v, 'auto', 'approved'], /permission denied/);
});

test('a stale automated verdict is logged but changes nothing', async () => {
  const c = await creator();
  const s = await newSeries(c);
  const v = await version('series', s);
  await db.asUser(c);
  await db.q(`select public.studio_update_series($1, 'Changed meanwhile')`, [s]);
  assert.equal(await record('series', s, v, 'approved'), 'stale_verdict');
  await db.asPostgres();
  assert.equal((await db.one<{ m: string }>('select moderation_status as m from public.series where id = $1', [s])).m, 'pending');
});
