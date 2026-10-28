import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, type TestDb } from './harness.ts';

let db: TestDb;
before(async () => {
  db = await freshDb();
});
after(async () => {
  await db.close();
});

test('a new auth user gets profile rows with unknown age', async () => {
  const id = await db.createUser('new@example.com');
  await db.asUser(id);
  const pp = await db.one<{ age_status: string }>('select age_status from public.profile_private');
  assert.equal(pp.age_status, 'unknown');
  const adult = await db.one<{ a: boolean }>('select public.is_adult() as a');
  assert.equal(adult.a, false);
});

test('an adult date of birth makes the account adult, once', async () => {
  const id = await db.createUser('adult@example.com');
  await db.asUser(id);
  const r = await db.one<{ s: string }>(`select public.set_my_date_of_birth('1990-01-01') as s`);
  assert.equal(r.s, 'adult');
  assert.equal((await db.one<{ a: boolean }>('select public.is_adult() as a')).a, true);
  await db.fails(`select public.set_my_date_of_birth('1980-01-01')`, [], /date_of_birth_already_set/);
});

test('the date of birth cannot be changed directly', async () => {
  const id = await db.createAdult('direct@example.com');
  await db.asUser(id);
  await db.fails(`update public.profile_private set date_of_birth = '2015-01-01'`, [], /permission denied/);
  await db.fails(`update public.profile_private set age_status = 'adult'`, [], /permission denied/);
  // Even the owner role can't rewrite it (trigger).
  await db.asPostgres();
  await db.fails(`update public.profile_private set date_of_birth = '1970-01-01' where user_id = $1`, [id],
    /date_of_birth_already_set/);
});

test('an under-18 date of birth blocks and queues the account instead of failing', async () => {
  const id = await db.createUser('Minor@Example.com');
  await db.asUser(id);
  const sixteen = new Date();
  sixteen.setFullYear(sixteen.getFullYear() - 16);
  const r = await db.one<{ s: string }>('select public.set_my_date_of_birth($1::date) as s', [sixteen.toISOString().slice(0, 10)]);
  assert.equal(r.s, 'blocked');
  assert.equal((await db.one<{ a: boolean }>('select public.is_adult() as a')).a, false);
  const st = await db.one<{ age_status: string }>('select age_status from public.profile_private');
  assert.equal(st.age_status, 'blocked');
  await db.asPostgres();
  const q = await db.one<{ reason: string }>('select reason from app_private.account_deletion_queue where user_id = $1', [id]);
  assert.equal(q.reason, 'under_18');
  const blocks = await db.one<{ n: number }>('select count(*)::int as n from app_private.age_blocks');
  assert.ok(blocks.n >= 1);
});

test('the same email signing up again within 90 days starts blocked', async () => {
  const id = await db.createUser('  minor@example.COM ');
  await db.asUser(id);
  const st = await db.one<{ age_status: string }>('select age_status from public.profile_private');
  assert.equal(st.age_status, 'blocked');
  // Declaring an adult date now doesn't unblock it.
  const r = await db.one<{ s: string }>(`select public.set_my_date_of_birth('1990-01-01') as s`);
  assert.equal(r.s, 'blocked');
});

test('exactly 18 today is adult; one day short is not', async () => {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const eighteen = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  const almost = new Date(eighteen.getTime() + 24 * 3600 * 1000);
  const a = await db.createUser('eighteen@example.com');
  await db.asUser(a);
  assert.equal((await db.one<{ s: string }>('select public.set_my_date_of_birth($1::date) as s', [iso(eighteen)])).s, 'adult');
  const b = await db.createUser('almost@example.com');
  await db.asUser(b);
  assert.equal((await db.one<{ s: string }>('select public.set_my_date_of_birth($1::date) as s', [iso(almost)])).s, 'blocked');
});

test('dates in the future or before 1900 are rejected', async () => {
  const id = await db.createUser('weird@example.com');
  await db.asUser(id);
  await db.fails(`select public.set_my_date_of_birth('2999-01-01')`, [], /invalid_date_of_birth/);
  await db.fails(`select public.set_my_date_of_birth('1850-01-01')`, [], /invalid_date_of_birth/);
});

test('users read only their own private profile', async () => {
  const a = await db.createAdult('a@example.com');
  const b = await db.createAdult('b@example.com');
  await db.asUser(a);
  const rows = await db.q<{ user_id: string }>('select user_id from public.profile_private');
  assert.deepEqual(rows.map((r) => r.user_id), [a]);
  const theirs = await db.q('select date_of_birth from public.profile_private where user_id = $1', [b]);
  assert.deepEqual(theirs, []);
});

test('profiles can only be changed through moderated service RPCs', async () => {
  const a = await db.createAdult('handle@example.com');
  await db.asUser(a);
  await db.fails(`update public.profiles set display_name = 'x'`, [], /permission denied/);
  await db.fails(`update public.profiles set role = 'admin'`, [], /permission denied/);
  await db.fails(`select svc.update_profile($1, 'h', 'n', 'b')`, [a], /permission denied/);
  await db.asService();
  await db.q(`select svc.update_profile($1, 'kaan_1', 'Kaan', 'hello')`, [a]);
  await db.asUser(a);
  const p = await db.one<{ handle: string }>('select handle from public.profiles where id = $1', [a]);
  assert.equal(p.handle, 'kaan_1');
  assert.equal((await db.one<{ r: string }>('select public.get_my_role() as r')).r, 'user');
  await db.fails('select role from public.profiles', [], /permission denied/);
});

test('handles are unique case-insensitively and validated', async () => {
  const a = await db.createAdult('h1@example.com');
  const b = await db.createAdult('h2@example.com');
  await db.asService();
  await db.q(`select svc.update_profile($1, 'StoryMaker', null, null)`, [a]);
  await db.fails(`select svc.update_profile($1, 'storymaker', null, null)`, [b], /duplicate key|unique/);
  await db.fails(`select svc.update_profile($1, 'no spaces!', null, null)`, [b], /check constraint/);
});

test('avatar keys must sit under the owner\'s own folder', async () => {
  const a = await db.createAdult('av@example.com');
  const b = await db.createAdult('av2@example.com');
  await db.asService();
  await db.q(`select svc.set_avatar($1, $2)`, [a, `public/avatars/${a}/1.webp`]);
  await db.fails(`select svc.set_avatar($1, $2)`, [a, `public/avatars/${b}/1.webp`], /avatar_key_is_own/);
  await db.fails(`select svc.set_avatar($1, $2)`, [a, `private/secret.webp`], /avatar_key_is_own/);
});

test('mature opt-in requires an adult account', async () => {
  const adult = await db.createAdult('mature@example.com');
  await db.asUser(adult);
  await db.q('update public.profile_private set mature_opt_in = true');
  assert.equal((await db.one<{ m: boolean }>('select mature_opt_in as m from public.profile_private')).m, true);

  const kid = await db.createUser('kid2@example.com');
  await db.asUser(kid);
  await db.q(`select public.set_my_date_of_birth('2015-01-01')`);
  await db.fails('update public.profile_private set mature_opt_in = true', [], /row-level security|violates/);
});

test('only live adults are listed; others see only themselves', async () => {
  const a = await db.createAdult('see1@example.com');
  const b = await db.createAdult('see1b@example.com');
  const pending = await db.createUser('see2@example.com');
  await db.asUser(pending);
  const visible = await db.q<{ id: string }>('select id from public.profiles');
  assert.deepEqual(visible.map((r) => r.id), [pending]);
  await db.asUser(a);
  const count = async (id: string) => (await db.one<{ n: number }>('select count(*)::int as n from public.profiles where id = $1', [id])).n;
  assert.equal(await count(b), 1, 'adults see adults');
  assert.equal(await count(pending), 0, 'unknown-age accounts are not listed');
  const minor = await db.createUser('see3@example.com');
  await db.asUser(minor);
  await db.q(`select public.set_my_date_of_birth('2014-01-01')`);
  await db.asUser(a);
  assert.equal(await count(minor), 0, 'blocked accounts are not listed');
});

test('age blocks catch +tags, Gmail dots, phone sign-ups and email changes', async () => {
  const kid = await db.createUser('young.reader@gmail.com');
  await db.asUser(kid);
  await db.q(`select public.set_my_date_of_birth('2013-03-03')`);
  for (const email of ['YoungReader+again@googlemail.com', 'y.o.u.n.g.reader@gmail.com']) {
    const id = await db.createUser(email);
    await db.asUser(id);
    assert.equal((await db.one<{ s: string }>('select age_status as s from public.profile_private')).s, 'blocked', email);
  }
  // A throwaway account switching its email to the blocked one is blocked too.
  const sneaky = await db.createAdult('throwaway@example.com');
  await db.asPostgres();
  await db.q(`update auth.users set email = 'youngreader@gmail.com' where id = $1`, [sneaky]);
  await db.asUser(sneaky);
  assert.equal((await db.one<{ a: boolean }>('select public.is_adult() as a')).a, false);
  // Phone sign-ups are remembered by number.
  await db.asPostgres();
  const ph = (await db.one<{ id: string }>(`insert into auth.users (phone) values ('+31 6 1234 5678') returning id`)).id;
  await db.asUser(ph);
  await db.q(`select public.set_my_date_of_birth('2012-01-01')`);
  await db.asPostgres();
  const ph2 = (await db.one<{ id: string }>(`insert into auth.users (phone) values ('+31612345678') returning id`)).id;
  await db.asUser(ph2);
  assert.equal((await db.one<{ s: string }>('select age_status as s from public.profile_private')).s, 'blocked');
});

test('blocked users can still withdraw AI consent', async () => {
  const a = await db.createAdult('withdraw@example.com');
  await db.asUser(a);
  await db.q(`select public.set_ai_consent('story', array['meta'], 'v', true)`);
  await db.q('select public.report_underage_signal()');
  // block_underage withdrew it already; withdrawing again must not fail.
  await db.q(`select public.set_ai_consent('story', null, null, false)`);
  const c = await db.one<{ w: string | null }>(`select withdrawn_at as w from public.ai_consents where purpose = 'story'`);
  assert.notEqual(c.w, null);
});

test('service profile writes refuse blocked or deleting accounts', async () => {
  const a = await db.createAdult('stale@example.com');
  await db.asUser(a);
  await db.q('select public.report_underage_signal()');
  await db.asService();
  await db.fails(`select svc.update_profile($1, 'x_stale', null, null)`, [a], /not_adult/);
  await db.fails(`select svc.set_avatar($1, $2)`, [a, `public/avatars/${a}/x.webp`], /not_adult/);
});

test('deletion jobs are claimed with a lease (no double claims)', async () => {
  const a = await db.createAdult('lease@example.com');
  await db.asUser(a);
  await db.q('select public.request_account_deletion()');
  await db.asService();
  const first = await db.q<{ user_id: string }>('select user_id from svc.claim_account_deletions(100)');
  const second = await db.q<{ user_id: string }>('select user_id from svc.claim_account_deletions(100)');
  assert.ok(first.some((r) => r.user_id === a));
  assert.ok(!second.some((r) => r.user_id === a));
});

test('deletion request scrubs the public profile and queues the job', async () => {
  const a = await db.createAdult('bye@example.com');
  await db.asService();
  await db.q(`select svc.update_profile($1, 'leaving', 'Leaving', 'bio')`, [a]);
  await db.asUser(a);
  await db.q('select public.request_account_deletion()');
  const p = await db.one<{ handle: string | null; display_name: string | null }>(
    'select handle, display_name from public.profiles where id = $1', [a]);
  assert.equal(p.handle, null);
  assert.equal(p.display_name, null);
  assert.equal((await db.one<{ a: boolean }>('select public.is_adult() as a')).a, false);
  await db.asService();
  const jobs = await db.q<{ user_id: string }>('select user_id from svc.claim_account_deletions(10)');
  assert.ok(jobs.some((j) => j.user_id === a));
});

test('AI consent can be given and withdrawn, and only by adults', async () => {
  const a = await db.createAdult('consent@example.com');
  await db.asUser(a);
  await db.q(`select public.set_ai_consent('story', array['meta','google'], '2026-10-27', true)`);
  let c = await db.one<{ withdrawn_at: string | null }>(`select withdrawn_at from public.ai_consents where purpose = 'story'`);
  assert.equal(c.withdrawn_at, null);
  await db.q(`select public.set_ai_consent('story', null, null, false)`);
  c = await db.one<{ withdrawn_at: string | null }>(`select withdrawn_at from public.ai_consents where purpose = 'story'`);
  assert.notEqual(c.withdrawn_at, null);
  await db.fails(`select public.set_ai_consent('telepathy', array['meta'], 'v', true)`, [], /invalid_purpose/);

  const kid = await db.createUser('kid3@example.com');
  await db.asUser(kid);
  await db.fails(`select public.set_ai_consent('story', array['meta'], 'v', true)`, [], /not_adult/);
});

test('the access-token hook adds age_ok', async () => {
  const a = await db.createAdult('hook@example.com');
  const u = await db.createUser('hook2@example.com');
  await db.asPostgres();
  await db.pg.exec('set role supabase_auth_admin');
  const ev = (id: string) => JSON.stringify({ user_id: id, claims: { sub: id, role: 'authenticated' } });
  const ra = await db.one<{ c: { claims: { age_ok: boolean } } }>('select public.custom_access_token_hook($1::jsonb) as c', [ev(a)]);
  assert.equal(ra.c.claims.age_ok, true);
  const ru = await db.one<{ c: { claims: { age_ok: boolean } } }>('select public.custom_access_token_hook($1::jsonb) as c', [ev(u)]);
  assert.equal(ru.c.claims.age_ok, false);
  await db.asPostgres();
});

test('anon can do nothing', async () => {
  await db.asAnon();
  await db.fails('select * from public.profiles', [], /permission denied/);
  await db.fails('select public.is_adult()', [], /permission denied/);
});

test('review 2: an under-18 block covers every identifier of the account (email and phone)', async () => {
  await db.asPostgres();
  const id = (await db.one<{ id: string }>(`insert into auth.users (email, phone) values ('kidboth@example.com', '+44 7700 900123') returning id`)).id;
  await db.asUser(id);
  const minor = new Date();
  minor.setFullYear(minor.getFullYear() - 15);
  assert.equal((await db.one<{ s: string }>('select public.set_my_date_of_birth($1::date) as s', [minor.toISOString().slice(0, 10)])).s, 'blocked');
  await db.asPostgres();
  const byPhone = (await db.one<{ id: string }>(`insert into auth.users (phone) values ('447700900123') returning id`)).id;
  const byEmail = (await db.one<{ id: string }>(`insert into auth.users (email) values ('KidBoth+new@example.com') returning id`)).id;
  const fresh = (await db.one<{ id: string }>(`insert into auth.users (email, phone) values ('someone-else@example.com', '+44 7700 900123') returning id`)).id;
  const status = async (u: string) => (await db.one<{ s: string }>('select age_status as s from public.profile_private where user_id = $1', [u])).s;
  assert.deepEqual([await status(byPhone), await status(byEmail), await status(fresh)], ['blocked', 'blocked', 'blocked']);
});
