// Trust & safety: reports, logged-out notices, blocks, statements of reasons, editor tools.
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
const randomId = () => crypto.randomUUID();
const HASH = (c: string) => c.repeat(64);

async function creator(): Promise<string> {
  const id = await db.createAdult(`trust-${uniq()}@example.com`);
  await db.asUser(id);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], 'v1', true)`);
  return id;
}

async function adult(): Promise<string> {
  return db.createAdult(`user-${uniq()}@example.com`);
}

async function editor(role: 'editor' | 'admin' = 'editor'): Promise<string> {
  const id = await adult();
  await db.asPostgres();
  await db.q('update public.profiles set role = $2 where id = $1', [id, role]);
  return id;
}

async function newSeries(owner: string, format = 'live_action'): Promise<string> {
  await db.asUser(owner);
  return (await db.one<{ id: string }>(
    `select public.studio_create_series('Wrong Delivery', 'A box keeps arriving.', $1, 'general', 'en', 3, null, array['romance']) as id`,
    [format])).id;
}

async function approve(target: 'series' | 'episode', id: string) {
  await db.asService();
  const table = target === 'series' ? 'series' : 'episodes';
  const r = await db.one<{ r: string }>(
    `select svc.set_moderation($1, $2, 'approved', (select content_version from public.${table} where id = $2)) as r`, [target, id]);
  assert.equal(r.r, 'applied');
}

/** An approved, published series. */
async function publicSeries(format = 'live_action'): Promise<{ c: string; s: string }> {
  const c = await creator();
  const s = await newSeries(c, format);
  await approve('series', s);
  await db.asUser(c);
  await db.q(`select public.studio_set_series_status($1, 'published')`, [s]);
  return { c, s };
}

/** An episode with media attached (ready, waiting for its first review). */
async function mediaEpisode(owner: string, s: string): Promise<string> {
  await db.asUser(owner);
  const ep = (await db.one<{ id: string }>(`select public.studio_create_episode($1, 'Ep') as id`, [s])).id;
  const asset = `asset-${uniq()}`;
  await db.asService();
  await db.q('select svc.check_episode_upload($1, $2)', [owner, ep]);
  await db.q('select svc.bind_episode_upload($1, $2)', [ep, asset]);
  await db.q(`select svc.attach_episode_media($1, 'cf_stream', $2, 45, null, null)`, [ep, asset]);
  return ep;
}

async function publishedEpisode(owner: string, s: string): Promise<string> {
  const ep = await mediaEpisode(owner, s);
  await approve('episode', ep);
  await db.asUser(owner);
  assert.equal((await db.one<{ s: string }>('select public.studio_publish_episode($1) as s', [ep])).s, 'published');
  return ep;
}

/** A published series whose creator earns: episodes 4 and 5 cost 25 coins. */
async function sellingSeries() {
  const { c, s } = await publicSeries();
  const eps: string[] = [];
  for (let i = 0; i < 5; i++) eps.push(await publishedEpisode(c, s));
  await db.asService();
  await db.q(`select svc.set_creator_status($1, 'active', '2026-10-27')`, [c]);
  return { c, s, eps };
}

async function buyer(): Promise<string> {
  const u = await adult();
  await db.asService();
  await db.q(`select svc.credit_purchase($1, $2, 'app_store', $3, 'reeltale.coins.100', 'production', 700000)`, [u, `e-${uniq()}`, `t-${uniq()}`]);
  return u;
}

async function unlock(u: string, ep: string) {
  await db.asUser(u);
  await db.q('select public.unlock_episode($1, 25)', [ep]);
}

async function balance(u: string): Promise<number> {
  await db.asUser(u);
  return (await db.one<{ w: { balance: number } }>('select public.get_my_wallet() as w')).w.balance;
}

async function playback(user: string, ep: string): Promise<string> {
  await db.asService();
  return (await db.one<{ r: { reason: string } }>('select svc.playback_check($1, $2) as r', [user, ep])).r.reason;
}

async function report(user: string, type: string, id: string, reason = 'spam_scam', details: string | null = null): Promise<number> {
  await db.asUser(user);
  return (await db.one<{ id: number }>('select public.report_content($1, $2, $3, $4)::int as id', [type, id, reason, details])).id;
}

async function notice(type: string, id: string, hash: string, reason = 'copyright', name: string | null = 'Ann Example',
  email: string | null = 'ann@example.com'): Promise<string> {
  await db.asService();
  return (await db.one<{ r: string }>('select svc.submit_notice($1, $2, $3, $4, $5, $6, $7) as r',
    [type, id, reason, 'This is my film, uploaded without permission.', name, email, hash])).r;
}

async function seesSeries(user: string, s: string): Promise<boolean> {
  await db.asUser(user);
  return (await db.q('select 1 from public.series where id = $1', [s])).length === 1;
}

async function seesProfile(user: string, p: string): Promise<boolean> {
  await db.asUser(user);
  return (await db.q('select 1 from public.profiles where id = $1', [p])).length === 1;
}

async function actions(targetId: string) {
  await db.asPostgres();
  return db.q<{ action: string; ground: string | null; reference: string | null; facts: string; automated: boolean;
    editor_id: string; report_ids: number[] }>(
    `select action, ground, reference, facts, automated, editor_id, report_ids::int[] as report_ids
     from app_private.moderation_actions where target_id = $1 order by id`, [targetId]);
}

async function takeDown(ed: string, target: string, id: string, reportIds: number[] = [], ground = 'terms') {
  await db.asService();
  return (await db.one<{ r: { outcome: string; recredit: string[]; reports_resolved: number } }>(
    `select svc.take_down($1, $2, $3, $4, 'Terms §7.2 (sexual content)', 'Explicit scenes in episodes 1-3.', $5::bigint[]) as r`,
    [target, id, ed, ground, reportIds])).r;
}

// ---- reports -----------------------------------------------------------------------------------

test('signed-in adults report what they can see; only the reporter reads the report, never who made it', async () => {
  const { c, s } = await publicSeries();
  const ep = await publishedEpisode(c, s);
  const r = await adult();
  const other = await adult();

  const id = await report(r, 'series', s, 'copyright', '  stolen from my channel  ');
  await db.asUser(r);
  assert.deepEqual(await db.one('select id::int, target_type, target_id, reason, details, status, resolved_at from public.reports where id = $1', [id]),
    { id, target_type: 'series', target_id: s, reason: 'copyright', details: 'stolen from my channel', status: 'open', resolved_at: null });
  assert.equal(await report(r, 'series', s, 'other'), id, 'an open report on the same target is returned, not duplicated');
  await db.asPostgres();
  assert.equal((await db.q('select 1 from public.reports where reporter_id = $1', [r])).length, 1);

  assert.equal(typeof await report(r, 'episode', ep), 'number');
  assert.equal(typeof await report(r, 'profile', c, 'impersonation'), 'number');

  for (const u of [other, c]) {
    await db.asUser(u);
    assert.equal((await db.q('select 1 from public.reports')).length, 0, 'nobody else sees the reports, the reported creator included');
  }
  await db.asUser(r);
  await db.fails('select reporter_id from public.reports', [], /permission denied/);
  await db.fails('select resolved_by from public.reports', [], /permission denied/);
  await db.fails('select source from public.reports', [], /permission denied/);
  await db.fails(`insert into public.reports (target_type, target_id, reason, source) values ('series', $1, 'other', 'user')`, [s], /permission denied/);
  await db.fails(`update public.reports set status = 'dismissed' where id = $1`, [id], /permission denied/);
  await db.fails('delete from public.reports where id = $1', [id], /permission denied/);

  await db.asAnon();
  await db.fails(`select public.report_content('series', $1, 'other')`, [s], /permission denied/);
  const minor = await db.createUser(`nodob-${uniq()}@example.com`);
  await db.asUser(minor);
  await db.fails(`select public.report_content('series', $1, 'other')`, [s], /not_adult/);
});

test('reports are validated and only reach content people could have seen', async () => {
  const { c, s } = await publicSeries();
  const r = await adult();
  await db.asUser(r);
  await db.fails(`select public.report_content('comment', $1, 'other')`, [s], /invalid_target/);
  await db.fails(`select public.report_content('series', $1, 'meh')`, [s], /invalid_reason/);
  await db.fails(`select public.report_content('series', $1, 'other', $2)`, [s, 'x'.repeat(2001)], /invalid_details/);

  const pending = await newSeries(c);
  const unreviewedEp = await mediaEpisode(c, s);
  const gone = (await publicSeries()).s;
  await db.asService();
  await db.q('select svc.remove_series($1)', [gone]);
  const underage = await db.createUser(`minor-${uniq()}@example.com`);
  await db.asUser(underage);
  await db.q(`select public.set_my_date_of_birth('2015-01-01')`);
  for (const [type, id] of [['series', pending], ['series', randomId()], ['series', gone], ['episode', unreviewedEp],
    ['profile', underage], ['profile', randomId()], ['ai_scene', randomId()]] as const) {
    await db.asUser(r);
    await db.fails('select public.report_content($1, $2, $3)', [type, id, 'other'], /target_not_found/);
  }

  // AI scenes are private to their story's owner until the story is published.
  await db.asPostgres();
  const story = (await db.one<{ id: string }>(
    `insert into public.ai_stories (owner_id, premise) values ($1, 'A lighthouse keeper finds letters from the future.') returning id`, [c])).id;
  const scene = (await db.one<{ id: string }>('insert into public.ai_scenes (story_id) values ($1) returning id', [story])).id;
  assert.equal(typeof await report(c, 'ai_scene', scene, 'ai_not_labelled'), 'number', 'owners report what the AI made for them');
  await db.asUser(r);
  await db.fails(`select public.report_content('ai_scene', $1, 'other')`, [scene], /target_not_found/);
  await db.asPostgres();
  await db.q(`update public.ai_stories set visibility = 'published' where id = $1`, [story]);
  assert.equal(typeof await report(r, 'ai_scene', scene), 'number');
});

test('at most 20 reports a day per user; older ones stop counting', async () => {
  const { s } = await publicSeries();
  const u = await adult();
  await db.asPostgres();
  await db.q(`insert into public.reports (target_type, target_id, reason, source, reporter_id)
              select 'series', gen_random_uuid(), 'spam_scam', 'user', $1 from generate_series(1, 20)`, [u]);
  await db.asUser(u);
  await db.fails(`select public.report_content('series', $1, 'other')`, [s], /rate_limited/);
  await db.asPostgres();
  await db.q(`update public.reports set created_at = now() - interval '25 hours' where reporter_id = $1`, [u]);
  assert.equal(typeof await report(u, 'series', s), 'number');
});

// ---- logged-out notices ------------------------------------------------------------------------

test('logged-out notices: service only, contact details kept private, anonymous only for child safety', async () => {
  const { s } = await publicSeries();
  assert.equal(await notice('series', s, HASH('a'), 'copyright', '  Ann Example ', ' ANN@Example.com '), 'received');
  await db.asPostgres();
  const row = await db.one<{ id: number; source: string; reporter_id: string | null; details: string; name: string; email: string; ip_hash: string }>(
    `select r.id::int, r.source, r.reporter_id, r.details, n.notifier_name as name, n.notifier_email as email, n.ip_hash
     from public.reports r join app_private.report_notices n on n.report_id = r.id where r.target_id = $1`, [s]);
  assert.deepEqual({ ...row, id: undefined }, { id: undefined, source: 'notice', reporter_id: null,
    details: 'This is my film, uploaded without permission.', name: 'Ann Example', email: 'ann@example.com', ip_hash: HASH('a') });

  await db.asService();
  const call = (reason: string, name: string | null, email: string | null, details = 'Clearly illegal content here.', hash = HASH('a')) =>
    db.q('select svc.submit_notice($1, $2, $3, $4, $5, $6, $7)', ['series', s, reason, details, name, email, hash]);
  await assert.rejects(db.q(`select svc.submit_notice('comment', $1, 'other', 'details', 'Ann', 'a@b.co', $2)`, [s, HASH('a')]), /invalid_target/);
  await assert.rejects(call('meh', 'Ann', 'ann@example.com'), /invalid_reason/);
  await assert.rejects(call('copyright', null, 'ann@example.com'), /invalid_notifier/);
  await assert.rejects(call('copyright', 'Ann', null), /invalid_notifier/);
  await assert.rejects(call('copyright', 'Ann', 'not-an-email'), /invalid_notifier/);
  await assert.rejects(call('copyright', 'A'.repeat(101), 'ann@example.com'), /invalid_notifier/);
  await assert.rejects(call('copyright', 'Ann', 'ann@example.com', '   '), /invalid_details/);
  await assert.rejects(call('copyright', 'Ann', 'ann@example.com', undefined, 'abc'), /invalid_ip_hash/);
  await assert.rejects(call('copyright', 'Ann', 'ann@example.com', undefined, HASH('A')), /invalid_ip_hash/);
  assert.equal(await notice('series', s, HASH('a'), 'minor_safety', null, null), 'received', 'child-safety notices may be anonymous');

  // Unknown or unreportable targets store nothing (the Worker answers the same either way).
  await db.asPostgres();
  const before = (await db.one<{ n: number }>('select count(*)::int as n from public.reports')).n;
  assert.equal(await notice('series', randomId(), HASH('a')), 'not_reportable');
  await db.asPostgres();
  assert.equal((await db.one<{ n: number }>('select count(*)::int as n from public.reports')).n, before);

  const u = await adult();
  await db.asUser(u);
  await db.fails(`select svc.submit_notice('series', $1, 'other', 'details', 'A', 'a@b.co', $2)`, [s, HASH('a')], /permission denied/);
  await db.asService();
  await db.fails('select * from app_private.report_notices', [], /permission denied/);
  await db.asAnon();
  await db.fails(`select svc.submit_notice('series', $1, 'other', 'details', 'A', 'a@b.co', $2)`, [s, HASH('a')], /permission denied/);
});

test('notices are capped per hashed IP per day', async () => {
  const { s } = await publicSeries();
  for (let i = 0; i < 10; i++) assert.equal(await notice('series', s, HASH('b')), 'received');
  await assert.rejects(notice('series', s, HASH('b')), /rate_limited/);
  assert.equal(await notice('series', s, HASH('c')), 'received', 'another address is not affected');
  await db.asPostgres();
  await db.q(`update app_private.report_notices set created_at = now() - interval '25 hours' where ip_hash = $1`, [HASH('b')]);
  assert.equal(await notice('series', s, HASH('b')), 'received');
});

test('purging forgets IP hashes after two days and notifier contacts a while after the decision', async () => {
  const { s } = await publicSeries();
  const ed = await editor();
  await notice('series', s, HASH('d'));
  await notice('series', s, HASH('e'));
  await db.asPostgres();
  const [oldId, newId] = (await db.q<{ id: number }>(
    `select report_id::int as id from app_private.report_notices where ip_hash = any ($1) order by ip_hash`, [[HASH('d'), HASH('e')]])).map((r) => r.id);
  await db.q(`update app_private.report_notices set created_at = now() - interval '3 days' where report_id = $1`, [oldId]);
  await db.asService();
  await db.q('select svc.dismiss_report($1, $2)', [oldId, ed]);
  await db.q('select svc.dismiss_report($1, $2)', [newId, ed]);
  assert.equal((await db.one<{ n: number }>('select svc.purge_notice_contacts(180) as n')).n, 0, 'decided too recently');
  await db.asPostgres();
  await db.q(`update public.reports set resolved_at = now() - interval '200 days' where id = $1`, [oldId]);
  await db.asService();
  assert.equal((await db.one<{ n: number }>('select svc.purge_notice_contacts(180) as n')).n, 1);
  await db.asPostgres();
  const rows = await db.q(`select report_id::int as id, notifier_name, notifier_email, ip_hash, contact_purged_at is not null as purged
                           from app_private.report_notices where report_id = any ($1) order by report_id`, [[oldId, newId]]);
  assert.deepEqual(rows, [
    { id: oldId, notifier_name: null, notifier_email: null, ip_hash: null, purged: true },
    { id: newId, notifier_name: 'Ann Example', notifier_email: 'ann@example.com', ip_hash: HASH('e'), purged: false },
  ]);
});

// ---- blocks ------------------------------------------------------------------------------------

test('blocking hides the creator\'s series and profile from the blocker only; unblocking brings them back', async () => {
  const { c, s } = await publicSeries();
  const u = await adult();
  const other = await adult();
  await db.asUser(u);
  await db.q('insert into public.follows (series_id) values ($1)', [s]);
  assert.deepEqual([await seesSeries(u, s), await seesProfile(u, c)], [true, true]);

  await db.asUser(u);
  await db.q('select public.block_user($1)', [c]);
  await db.q('select public.block_user($1)', [c]);   // twice is fine
  assert.deepEqual([await seesSeries(u, s), await seesProfile(u, c)], [false, false]);
  await db.asUser(u);
  assert.equal((await db.q('select 1 from public.follows where series_id = $1', [s])).length, 0, 'the follow ends with the block');
  assert.deepEqual(await db.q('select blocked_id from public.blocks'), [{ blocked_id: c }]);
  assert.deepEqual([await seesSeries(other, s), await seesProfile(other, c)], [true, true], 'nobody else is affected');
  for (const x of [other, c]) {
    await db.asUser(x);
    assert.equal((await db.q('select 1 from public.blocks')).length, 0, 'blocks are private');
  }
  assert.equal(await seesProfile(c, u), true, 'blocks are one-way');

  await db.asUser(u);
  await db.q('select public.unblock_user($1)', [c]);
  assert.deepEqual([await seesSeries(u, s), await seesProfile(u, c)], [true, true]);

  await db.asUser(u);
  await db.fails('select public.block_user($1)', [u], /cannot_block_self/);
  await db.fails('select public.block_user($1)', [randomId()], /user_not_found/);
  // A hidden account (no adult date of birth yet) answers like a missing one.
  const hidden = await db.createUser(`hidden-${randomId()}@example.com`);
  await db.asUser(u);
  await db.fails('select public.block_user($1)', [hidden], /user_not_found/);
  await db.fails('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [u, c], /permission denied/);
  await db.fails('delete from public.blocks', [], /permission denied/);
  await db.asAnon();
  await db.fails('select public.block_user($1)', [c], /permission denied/);
});

test('a block never takes away what the blocker bought', async () => {
  const { c, s, eps } = await sellingSeries();
  const b = await buyer();
  await unlock(b, eps[3]!);
  const stranger = await adult();
  for (const u of [b, stranger]) {
    await db.asUser(u);
    await db.q('select public.block_user($1)', [c]);
  }
  assert.equal(await seesSeries(b, s), true, 'the buyer keeps the series of an episode they unlocked');
  await db.asUser(b);
  assert.equal((await db.q('select 1 from public.episodes where id = $1', [eps[3]])).length, 1);
  assert.equal(await playback(b, eps[3]!), 'unlocked');
  assert.equal(await seesSeries(stranger, s), false);
  await db.asUser(stranger);
  assert.equal((await db.q('select 1 from public.episodes where series_id = $1', [s])).length, 0);
});

// ---- editors -----------------------------------------------------------------------------------

test('editor_role: editors and admins with a live adult account; service only', async () => {
  const e = await editor();
  const a = await editor('admin');
  const u = await adult();
  const leaving = await editor();
  await db.asUser(leaving);
  await db.q('select public.request_account_deletion()');
  await db.asService();
  const role = async (id: string) => (await db.one<{ r: string | null }>('select svc.editor_role($1) as r', [id])).r;
  assert.deepEqual([await role(e), await role(a), await role(u), await role(leaving), await role(randomId())],
    ['editor', 'admin', null, null, null]);

  await db.asUser(e);
  for (const [sql, args] of [
    ['select svc.editor_role($1)', [e]],
    ['select svc.editor_queue(10)', []],
    [`select svc.take_down('series', $1, $2, 'terms', 'r', 'f')`, [randomId(), e]],
    ['select svc.dismiss_report(1, $1)', [e]],
    ['select svc.set_editors_pick($1, true, $2)', [randomId(), e]],
    ['select svc.purge_notice_contacts(180)', []],
  ] as [string, unknown[]][]) {
    await db.fails(sql, args, /permission denied/);
  }
});

test('editor_verdict: recorded as the editor through record_verdict, never about the editor\'s own content', async () => {
  const ed = await editor();
  const verdict = async (target: string, id: string, version: number, who = ed, decision = 'approved') => {
    await db.asService();
    return (await db.one<{ r: string }>(`select svc.editor_verdict($1, $2, $3, $4, array['ok'], 'Looks fine.', $5) as r`,
      [target, id, version, decision, who])).r;
  };
  const version = async (id: string) => {
    await db.asPostgres();
    return (await db.one<{ v: number }>('select content_version as v from public.series where id = $1', [id])).v;
  };

  const other = await newSeries(await creator());
  assert.equal(await verdict('series', other, await version(other)), 'applied');
  await db.asPostgres();
  assert.deepEqual(await db.one(`select source, decision, editor_id, outcome from app_private.moderation_verdicts
                                 where target_id = $1 order by id desc limit 1`, [other]),
    { source: 'editor', decision: 'approved', editor_id: ed, outcome: 'applied' });
  assert.equal((await db.one<{ m: string }>('select moderation_status as m from public.series where id = $1', [other])).m, 'approved');

  // The editor's own series, its episodes and its pending edits go to another editor.
  await db.asUser(ed);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], 'v1', true)`);
  const own = await newSeries(ed);
  await assert.rejects(verdict('series', own, await version(own)), /conflict_of_interest/);
  await assert.rejects(verdict('series', own, await version(own), ed, 'rejected'), /conflict_of_interest/);
  const ownEp = await mediaEpisode(ed, own);
  await assert.rejects(verdict('episode', ownEp, 1), /conflict_of_interest/);
  assert.equal(await verdict('series', own, await version(own), await editor()), 'applied', 'another editor can');
  await db.asUser(ed);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_series($1, p_title => 'Renamed') as r`, [own])).r, 'awaiting_review');
  await assert.rejects(verdict('series_edit', own, 1), /conflict_of_interest/);
  await db.asPostgres();
  assert.deepEqual(await db.q(`select 1 from app_private.moderation_verdicts where editor_id = $1 and target_id = any ($2)`,
    [ed, [own, ownEp]]), [], 'refused verdicts record nothing');
  assert.equal((await db.one<{ n: number }>(`select count(*)::int as n from public.pending_edits where target_id = $1 and status = 'pending'`,
    [own])).n, 1);

  await assert.rejects(verdict('series', other, 1, await adult()), /not_an_editor/);
  await assert.rejects(verdict('comment', other, 1), /invalid_target/);
  await db.asUser(ed);
  await db.fails(`select svc.editor_verdict('series', $1, 1, 'approved', null, null, $2)`, [other, ed], /permission denied/);
});

test('take_down of a series: removed, reports actioned, statement recorded, buyers re-credited in pages', async () => {
  const { c, s, eps } = await sellingSeries();
  const ed = await editor();
  const a = await buyer();
  const b = await buyer();
  await unlock(a, eps[3]!);
  await unlock(b, eps[3]!);
  await unlock(a, eps[4]!);
  const r1 = await adult();
  const r2 = await adult();
  const onSeries = await report(r1, 'series', s, 'sexual_content');
  const onEpisode = await report(r2, 'episode', eps[3]!, 'violence');
  const onProfile = await report(r2, 'profile', c, 'impersonation');
  await notice('series', s, HASH('f'));
  await db.asPostgres();
  const fromNotice = (await db.one<{ id: number }>(
    `select r.id::int from public.reports r join app_private.report_notices n on n.report_id = r.id where n.ip_hash = $1`, [HASH('f')])).id;

  await db.asService();
  await db.fails(`select svc.take_down('series', $1, $2, 'terms', 'r', 'f')`, [s, c], /not_an_editor/);
  await db.fails(`select svc.take_down('series', $1, $2, 'feelings', 'r', 'f')`, [s, ed], /invalid_ground/);
  await db.fails(`select svc.take_down('series', $1, $2, 'terms', 'r', '  ')`, [s, ed], /invalid_statement/);
  await db.fails(`select svc.take_down('series', $1, $2, 'terms', null, 'f')`, [s, ed], /invalid_statement/);
  await db.fails(`select svc.take_down('series', $1, $2, 'terms', 'r', 'f', $3::bigint[])`, [s, ed, [onProfile]], /report_mismatch/);
  await db.fails(`select svc.take_down('series', $1, $2, 'terms', 'r', 'f')`, [randomId(), ed], /not_found/);

  const first = await takeDown(ed, 'series', s, [onSeries]);
  assert.deepEqual({ ...first, recredit: [...first.recredit].sort() },
    { outcome: 'removed', recredit: [eps[3], eps[4]].sort(), reports_resolved: 3 });
  await db.asUser(r1);
  assert.deepEqual(await db.one('select status, resolved_at is not null as resolved from public.reports where id = $1', [onSeries]),
    { status: 'actioned', resolved: true });
  await db.asUser(r2);
  assert.deepEqual(await db.q('select id::int, status from public.reports order by id'),
    [{ id: onEpisode, status: 'actioned' }, { id: onProfile, status: 'open' }]);
  assert.deepEqual(await actions(s), [{
    action: 'take_down', ground: 'terms', reference: 'Terms §7.2 (sexual content)', facts: 'Explicit scenes in episodes 1-3.',
    automated: false, editor_id: ed, report_ids: [onSeries, onEpisode, fromNotice].sort((x, y) => x - y),
  }]);
  assert.equal(await seesSeries(a, s), false);
  assert.equal(await playback(a, eps[3]!), 'not_available');
  await db.asUser(r1);
  await db.fails(`select public.report_content('series', $1, 'other')`, [s], /target_not_found/);

  // Re-crediting is paged; calling take_down again reports what is left and records nothing new.
  await db.asService();
  await db.q(`select svc.recredit_episode($1, 'moderation', 1)`, [eps[3]]);
  await db.q(`select svc.recredit_episode($1, 'moderation', 1)`, [eps[4]]);
  assert.deepEqual(await takeDown(ed, 'series', s), { outcome: 'already_removed', recredit: [eps[3]], reports_resolved: 0 });
  await db.asService();
  await db.q(`select svc.recredit_episode($1, 'moderation', 10)`, [eps[3]]);
  assert.deepEqual(await takeDown(ed, 'series', s), { outcome: 'already_removed', recredit: [], reports_resolved: 0 });
  assert.equal((await actions(s)).length, 1);
  assert.deepEqual([await balance(a), await balance(b)], [100, 100]);

  // The creator gets the statement of reasons (not who reported, not which editor).
  await db.asUser(c);
  const mine = (await db.one<{ r: Record<string, unknown>[] }>('select public.get_my_moderation_actions() as r')).r;
  assert.equal(mine.length, 1);
  const { id: _id, created_at: _at, ...statement } = mine[0]!;
  assert.deepEqual(statement, { target_type: 'series', target_id: s, action: 'take_down', ground: 'terms',
    reference: 'Terms §7.2 (sexual content)', facts: 'Explicit scenes in episodes 1-3.', automated: false, after_report: true });
  await db.asUser(r1);
  assert.deepEqual((await db.one<{ r: unknown[] }>('select public.get_my_moderation_actions() as r')).r, []);
  await db.asAnon();
  await db.fails('select public.get_my_moderation_actions()', [], /permission denied/);
});

test('take_down of one episode leaves the rest of the series alone', async () => {
  const { c, s, eps } = await sellingSeries();
  const ed = await editor();
  const b = await buyer();
  await unlock(b, eps[3]!);
  await db.asUser(c);
  assert.equal((await db.one<{ r: string }>(`select public.studio_update_episode($1, 'New title') as r`, [eps[3]])).r, 'awaiting_review');

  assert.deepEqual(await takeDown(ed, 'episode', eps[3]!, [], 'legal'), { outcome: 'removed', recredit: [eps[3]], reports_resolved: 0 });
  await db.asPostgres();
  assert.deepEqual(await db.q('select id, status from public.episodes where id = any ($1) order by number', [[eps[3], eps[4]]]),
    [{ id: eps[3], status: 'removed' }, { id: eps[4], status: 'published' }]);
  assert.equal((await db.q(`select 1 from public.pending_edits where target = 'episode' and target_id = $1`, [eps[3]])).length, 0);
  assert.equal((await db.one<{ s: string }>('select status as s from public.series where id = $1', [s])).s, 'published');
  assert.equal(await playback(b, eps[3]!), 'not_available');
  assert.equal((await actions(eps[3]!))[0]?.ground, 'legal');
  await db.asService();
  assert.equal((await db.one<{ n: number }>(`select svc.recredit_episode($1, 'moderation') as n`, [eps[3]])).n, 1);
  assert.equal(await balance(b), 100);
  await db.asService();
  await db.fails(`select svc.take_down('episode', $1, $2, 'terms', 'r', 'f')`, [randomId(), ed], /not_found/);
  await db.fails(`select svc.take_down('comment', $1, $2, 'terms', 'r', 'f')`, [eps[4], ed], /invalid_target/);
});

test('Editor\'s Pick: approved, live series only, never the editor\'s own; recorded; makes an AI series monetisable', async () => {
  const ed = await editor();
  const { c, s } = await publicSeries('ai_generated');
  await db.asUser(c);
  await db.fails('select public.studio_update_series($1, p_default_price_coins => 25)', [s], /ai_series_free_until_editors_pick/);

  const pick = async (series: string, on: boolean, who = ed) => {
    await db.asService();
    return (await db.one<{ r: string }>(`select svc.set_editors_pick($1, $2, $3, 'Strong pilot') as r`, [series, on, who])).r;
  };
  assert.equal(await pick(s, true), 'applied');
  assert.equal(await pick(s, true), 'unchanged');
  await db.asUser(c);
  await db.q('select public.studio_update_series($1, p_default_price_coins => 25)', [s]);
  assert.equal(await pick(s, false), 'applied');
  assert.deepEqual((await actions(s)).map((x) => [x.action, x.facts, x.editor_id]),
    [['editors_pick_on', 'Strong pilot', ed], ['editors_pick_off', 'Strong pilot', ed]]);
  // Losing the pick ends the series' earnings: the creator gets a statement for it (not for gaining it).
  await db.asUser(c);
  const statements = (await db.one<{ r: { action: string; target_id: string }[] }>('select public.get_my_moderation_actions() as r')).r;
  assert.deepEqual(statements.filter((x) => x.target_id === s).map((x) => x.action), ['editors_pick_off']);

  await assert.rejects(pick(s, true, c), /not_an_editor/);
  await assert.rejects(pick(randomId(), true), /not_found/);
  await assert.rejects(pick(await newSeries(c), true), /not_eligible/);
  const gone = (await publicSeries()).s;
  await db.asService();
  await db.q('select svc.remove_series($1)', [gone]);
  await assert.rejects(pick(gone, true), /not_eligible/);
  await db.asUser(ed);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], 'v1', true)`);
  const own = await newSeries(ed, 'ai_generated');
  await approve('series', own);
  await assert.rejects(pick(own, true), /conflict_of_interest/);
});

test('dismissing a report closes it and records why; the reporter sees the outcome', async () => {
  const { s } = await publicSeries();
  const ed = await editor();
  const r = await adult();
  const id = await report(r, 'series', s);
  const dismiss = async (rid: number, who = ed, note: string | null = null) => {
    await db.asService();
    return (await db.one<{ r: string }>('select svc.dismiss_report($1, $2, $3) as r', [rid, who, note])).r;
  };
  await assert.rejects(dismiss(id, r), /not_an_editor/);
  await assert.rejects(dismiss(2_000_000_000), /report_not_found/);
  assert.equal(await dismiss(id), 'dismissed');
  assert.equal(await dismiss(id), 'not_open');
  await db.asUser(r);
  assert.equal((await db.one<{ s: string }>('select status as s from public.reports where id = $1', [id])).s, 'dismissed');
  assert.deepEqual((await actions(s)).map((x) => [x.action, x.ground, x.facts, x.report_ids]),
    [['reports_dismissed', null, 'No breach of the law or of the Terms was found.', [id]]]);
  const again = await report(r, 'series', s);
  assert.notEqual(again, id, 'a closed report doesn\'t stop a new one');
  assert.equal(await dismiss(again, ed, 'Parody, clearly labelled.'), 'dismissed');
  assert.equal((await actions(s)).at(-1)?.facts, 'Parody, clearly labelled.');

  // Nobody dismisses reports about their own content or profile.
  const aboutEditor = await report(r, 'profile', ed, 'impersonation');
  await assert.rejects(dismiss(aboutEditor), /conflict_of_interest/);
  assert.equal(await dismiss(aboutEditor, await editor()), 'dismissed', 'another editor can');
  await db.asUser(ed);
  await db.q(`select public.set_ai_consent('upload_processing', array['meta'], 'v1', true)`);
  const own = await newSeries(ed);
  await approve('series', own);
  await assert.rejects(dismiss(await report(r, 'series', own)), /conflict_of_interest/);
});

test('the editor queue: items handed to an editor, and open reports grouped by target, child safety first', async () => {
  const ed = await editor();
  const { s: spam } = await publicSeries();
  const { s: unsafe } = await publicSeries();
  for (let i = 0; i < 3; i++) await report(await adult(), 'series', spam, i < 2 ? 'spam_scam' : 'other', `details ${i}`);
  const urgent = await report(await adult(), 'series', unsafe, 'minor_safety');
  const c = await creator();
  const held = await newSeries(c);
  await db.asService();
  await db.q(`select svc.record_verdict('series', $1, (select content_version from public.series where id = $1), 'auto',
              'muse-spark-1.3', 'needs_editor', null, 'unsure')`, [held]);

  type Group = { target_type: string; target_id: string; open_count: number; urgent: boolean; reasons: Record<string, number>;
    target: { title: string }; reports: Record<string, unknown>[] };
  const queue = async () => {
    await db.asService();
    return (await db.one<{ q: { items: { id: string }[]; reports: Group[] } }>('select svc.editor_queue(200) as q')).q;
  };
  let q = await queue();
  assert.ok(q.items.some((i) => i.id === held));
  const ids = q.reports.map((g) => g.target_id);
  assert.ok(ids.indexOf(unsafe) >= 0 && ids.indexOf(unsafe) < ids.indexOf(spam), 'child safety comes first');
  const g = q.reports.find((x) => x.target_id === spam)!;
  assert.deepEqual([g.target_type, g.open_count, g.urgent, g.reasons, g.target.title], ['series', 3, false, { spam_scam: 2, other: 1 }, 'Wrong Delivery']);
  assert.deepEqual(g.reports.map((x) => Object.keys(x).sort()), Array(3).fill(['created_at', 'details', 'id', 'reason', 'source']),
    'never who reported');

  await db.asService();
  await db.q('select svc.dismiss_report($1, $2)', [urgent, ed]);
  q = await queue();
  assert.ok(!q.reports.some((x) => x.target_id === unsafe), 'closed reports leave the queue');
});

test('statements of reasons are append-only, even for the owner role', async () => {
  const { s } = await publicSeries();
  const ed = await editor();
  await db.asService();
  await db.q(`select svc.set_editors_pick($1, true, $2)`, [s, ed]);
  await db.asPostgres();
  await db.fails('update app_private.moderation_actions set facts = $1 where target_id = $2', ['edited', s], /append-only/);
  await db.fails('delete from app_private.moderation_actions where target_id = $1', [s], /append-only/);
  await db.fails('truncate app_private.moderation_actions', [], /append-only/);
  assert.equal((await actions(s)).length, 1);
});
