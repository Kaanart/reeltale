// Voice input (supabase/migrations/20261101090000_voice.sql): the Worker may send a recording to Meta only for a
// live adult who has allowed voice input for Meta, and only the Worker can ask.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, type TestDb } from './harness.ts';

let db: TestDb;
before(async () => {
  db = await freshDb({ seed: false });
});
after(async () => {
  await db.close();
});

let seq = 0;
const email = () => `voice-${Date.now().toString(36)}${(seq++).toString(36)}@example.com`;

async function allowed(user: string | null): Promise<boolean> {
  await db.asService();
  return (await db.one<{ ok: boolean }>('select svc.voice_allowed($1) as ok', [user])).ok;
}

async function consent(user: string, providers: string[], granted = true) {
  await db.asUser(user);
  await db.q(`select public.set_ai_consent('voice', $1, '2026-10-22', $2)`, [providers, granted]);
}

test('a live adult with voice consent for Meta is allowed', async () => {
  const u = await db.createAdult(email());
  assert.equal(await allowed(u), false, 'no consent yet');
  await consent(u, ['meta']);
  assert.equal(await allowed(u), true);
});

test('consent for something else, for another provider, or withdrawn is not enough', async () => {
  const story = await db.createAdult(email());
  await db.asUser(story);
  await db.q(`select public.set_ai_consent('story', array['meta','google'], '2026-10-22', true)`);
  assert.equal(await allowed(story), false, 'story consent is not voice consent');

  const google = await db.createAdult(email());
  await consent(google, ['google']);
  assert.equal(await allowed(google), false, 'Meta must be named');

  const withdrawn = await db.createAdult(email());
  await consent(withdrawn, ['meta']);
  assert.equal(await allowed(withdrawn), true);
  await consent(withdrawn, ['meta'], false);
  assert.equal(await allowed(withdrawn), false, 'withdrawn in Settings');
  await consent(withdrawn, ['meta']);
  assert.equal(await allowed(withdrawn), true, 'given again');
});

test('an account that is not a live adult is refused even with a consent row', async () => {
  // A consent row can only be written by an adult; put one in directly for an account without a birthday.
  const unknown = await db.createUser(email());
  await db.asPostgres();
  await db.q(`insert into public.ai_consents (user_id, purpose, providers, version) values ($1, 'voice', array['meta'], '2026-10-22')`, [unknown]);
  assert.equal(await allowed(unknown), false, 'age not known');

  const deleted = await db.createAdult(email());
  await consent(deleted, ['meta']);
  await db.asUser(deleted);
  await db.q('select public.request_account_deletion()');
  assert.equal(await allowed(deleted), false, 'deleted account');

  // Deleted, but the consent row put back by hand: still refused, because the account isn't live.
  await db.asPostgres();
  await db.q(`update public.ai_consents set withdrawn_at = null where user_id = $1`, [deleted]);
  assert.equal(await allowed(deleted), false);

  assert.equal(await allowed(null), false);
  assert.equal(await allowed('00000000-0000-4000-8000-000000000000'), false, 'no such user');
});

test('only the service role can ask', async () => {
  const u = await db.createAdult(email());
  await consent(u, ['meta']);
  await db.asUser(u);
  await db.fails('select svc.voice_allowed($1)', [u], /permission denied/);
  await db.asAnon();
  await db.fails('select svc.voice_allowed($1)', [u], /permission denied/);
  await db.asPostgres();
  const r = await db.one<{ definer: boolean; cfg: string[] | null; anon: boolean; auth: boolean; svc: boolean }>(
    `select p.prosecdef as definer, p.proconfig as cfg,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'svc' and p.proname = 'voice_allowed'`);
  assert.equal(r.definer, true);
  assert.ok((r.cfg ?? []).some((c) => c === 'search_path=""' || c === "search_path=''"), 'search_path pinned');
  assert.deepEqual([r.anon, r.auth, r.svc], [false, false, true]);
});
