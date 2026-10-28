// Every privilege a client role holds must be listed here on purpose. A new table, column grant or
// function that isn't in these allowlists fails the test; that is the point (the worst Supabase bugs
// are grants nobody noticed).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, type TestDb } from './harness.ts';

const SCHEMAS = ['public', 'svc', 'ledger', 'app_private'];

// Column grants for `authenticated`, per table and privilege.
export const AUTHENTICATED_COLUMNS: Record<string, Partial<Record<'SELECT' | 'UPDATE' | 'INSERT', string[]>>> = {
  'public.profiles': { SELECT: ['avatar_key', 'bio', 'display_name', 'handle', 'id'] },
  'public.profile_private': {
    SELECT: ['age_status', 'ai_access_until', 'ai_safety_ack_at', 'country', 'date_of_birth', 'locale',
      'mature_opt_in', 'tos_accepted_at', 'tos_version', 'user_id'],
    UPDATE: ['locale', 'mature_opt_in'],
  },
  'public.ai_consents': { SELECT: ['accepted_at', 'providers', 'purpose', 'user_id', 'version', 'withdrawn_at'] },
  'public.tags': { SELECT: ['id', 'kind', 'name_i18n', 'slug', 'sort'] },
  'public.series': {
    SELECT: ['completed', 'cover_key', 'created_at', 'creator_id', 'default_price_coins', 'editors_pick', 'format',
      'free_episode_count', 'id', 'language', 'maturity', 'moderation_status', 'origin', 'published_at', 'slug', 'status',
      'synopsis', 'tag_ids', 'title', 'updated_at'],
  },
  'public.episodes': {
    SELECT: ['duration_s', 'id', 'is_free', 'kind', 'moderation_status', 'number', 'poster_key', 'preview_key',
      'price_coins', 'published_at', 'series_id', 'status', 'title'],
  },
  'public.episode_unlocks': { SELECT: ['coins_spent', 'created_at', 'episode_id', 'source', 'user_id'] },
  'public.pending_edits': { SELECT: ['created_at', 'fields', 'status', 'target', 'target_id', 'updated_at', 'version'] },
  'public.follows': { SELECT: ['created_at', 'series_id', 'user_id'], INSERT: ['series_id'] },
  'public.watch_progress': {
    SELECT: ['completed', 'episode_id', 'position_s', 'updated_at', 'user_id'],
    INSERT: ['completed', 'episode_id', 'position_s'],
    UPDATE: ['completed', 'position_s'],
  },
  // Ledger-adjacent tables: read-only for their owner; no internal ids (lots, transactions) exposed.
  'public.creator_accounts': { SELECT: ['accepted_at', 'agreement_version', 'payouts_enabled', 'share_bps', 'status', 'user_id'] },
  'public.daily_passes': { SELECT: ['used', 'user_id', 'utc_day'] },
  'public.earnings': {
    SELECT: ['amount_eur_micros', 'available_at', 'coins', 'created_at', 'creator_id', 'episode_id', 'id', 'is_reserve',
      'kind', 'status'],
  },
  'public.pricing_config': { SELECT: ['key', 'value'] },
  // AI stories: owner reads only; bible/arc/sheets, budgets and hold ids stay server-side.
  'public.ai_stories': {
    SELECT: ['created_at', 'id', 'mode', 'owner_id', 'premise', 'published_series_id', 'status', 'tags', 'title', 'updated_at',
      'visibility'],
  },
  'public.ai_scenes': { SELECT: ['chosen_choice', 'created_at', 'depth', 'id', 'is_ending', 'parent_scene_id', 'status', 'story_id', 'title'] },
  'public.ai_jobs': { SELECT: ['created_at', 'error_code', 'finished_at', 'id', 'kind', 'lane', 'progress', 'scene_id', 'status', 'story_id'] },
  'public.products': { SELECT: ['active', 'coins', 'kind', 'period', 'product_id', 'sort', 'tier'] },
  'public.subscriptions': {
    SELECT: ['auto_renew', 'environment', 'period_end', 'period_start', 'period_type', 'product_id', 'status', 'store',
      'store_original_transaction_id', 'tier', 'user_id'],
  },
};

// Table-level grants for `authenticated` (only where column grants can't express it, e.g. DELETE).
export const AUTHENTICATED_TABLE_GRANTS: string[] = ['public.follows:DELETE'];

// Functions `authenticated` may execute (schema.name).
export const AUTHENTICATED_FUNCTIONS = [
  'public.accept_terms',
  'public.creator_is_live',
  'public.get_episode_price',
  'public.get_my_role',
  'public.get_my_wallet',
  'public.has_ai_access',
  'public.has_unlock_in_series',
  'public.is_adult',
  'public.my_mature_opt_in',
  'public.profile_is_listed',
  'public.report_underage_signal',
  'public.request_account_deletion',
  'public.set_ai_consent',
  'public.set_my_date_of_birth',
  'public.studio_close_episode',
  'public.studio_create_episode',
  'public.studio_create_series',
  'public.studio_publish_episode',
  'public.studio_set_series_status',
  'public.studio_update_episode',
  'public.studio_update_series',
  'public.unlock_episode',
  'public.use_free_pass',
];

let db: TestDb;
before(async () => {
  db = await freshDb({ seed: false });
});
after(async () => {
  await db.close();
});

function extend<T>(base: T, extra: unknown): T {
  return extra === undefined ? base : (extra as T);
}

// Other test files can register their additions by exporting from here as the schema grows;
// for now everything lives in the lists above.
const columnsAllow = extend(AUTHENTICATED_COLUMNS, undefined);

test('anon has no privileges anywhere in our schemas', async () => {
  const tables = await db.q(
    `select table_schema || '.' || table_name as t, privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = any($1)`, [SCHEMAS]);
  assert.deepEqual(tables, []);
  const cols = await db.q(
    `select table_schema || '.' || table_name as t, column_name, privilege_type from information_schema.column_privileges
     where grantee = 'anon' and table_schema = any($1)`, [SCHEMAS]);
  assert.deepEqual(cols, []);
  const fns = await db.q<{ f: string }>(
    `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1) and has_function_privilege('anon', p.oid, 'EXECUTE')`, [SCHEMAS]);
  assert.deepEqual(fns, []);
});

test('authenticated holds only allowlisted table-level grants', async () => {
  const rows = await db.q<{ t: string; privilege_type: string }>(
    `select table_schema || '.' || table_name as t, privilege_type from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = any($1) order by 1, 2`, [SCHEMAS]);
  const got = rows.map((r) => `${r.t}:${r.privilege_type}`);
  assert.deepEqual(got, [...AUTHENTICATED_TABLE_GRANTS].sort());
});

test('authenticated holds exactly the allowlisted column grants', async () => {
  const rows = await db.q<{ t: string; column_name: string; privilege_type: string }>(
    `select table_schema || '.' || table_name as t, column_name, privilege_type
     from information_schema.column_privileges
     where grantee = 'authenticated' and table_schema = any($1)
       and privilege_type in ('SELECT', 'UPDATE', 'INSERT', 'REFERENCES')
     order by 1, 3, 2`, [SCHEMAS]);
  const got: Record<string, Record<string, string[]>> = {};
  for (const r of rows) {
    // Table-level grants also show up per column; those are covered by the table-level test.
    (got[r.t] ??= {});
    (got[r.t][r.privilege_type] ??= []).push(r.column_name);
  }
  const want: Record<string, Record<string, string[]>> = {};
  for (const [t, privs] of Object.entries(columnsAllow)) {
    want[t] = {};
    for (const [p, cols] of Object.entries(privs)) want[t][p] = [...(cols ?? [])].sort();
  }
  for (const t of Object.keys(got)) for (const p of Object.keys(got[t])) got[t][p].sort();
  assert.deepEqual(got, want);
});

test('authenticated can execute exactly the allowlisted functions', async () => {
  const rows = await db.q<{ f: string }>(
    `select distinct n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1) and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`, [SCHEMAS]);
  assert.deepEqual(rows.map((r) => r.f), [...AUTHENTICATED_FUNCTIONS].sort());
});

test('authenticated has no usage on svc, ledger or app_private', async () => {
  for (const s of ['svc', 'ledger', 'app_private']) {
    const r = await db.one<{ ok: boolean }>(`select has_schema_privilege('authenticated', $1, 'USAGE') as ok`, [s]);
    assert.equal(r.ok, false, s);
  }
});

test('service_role cannot touch ledger or app_private tables directly', async () => {
  const rows = await db.q(
    `select table_schema || '.' || table_name as t, privilege_type from information_schema.role_table_grants
     where grantee = 'service_role' and table_schema in ('ledger', 'app_private')`);
  assert.deepEqual(rows, []);
  for (const s of ['ledger', 'app_private']) {
    const r = await db.one<{ ok: boolean }>(`select has_schema_privilege('service_role', $1, 'USAGE') as ok`, [s]);
    assert.equal(r.ok, false, s);
  }
});

test('every security definer function pins search_path to empty', async () => {
  const rows = await db.q<{ f: string; cfg: string[] | null }>(
    `select n.nspname || '.' || p.proname as f, p.proconfig as cfg from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1) and p.prosecdef`, [SCHEMAS]);
  assert.ok(rows.length > 0);
  const bad = rows.filter((r) => !(r.cfg ?? []).some((c) => c === 'search_path=""' || c === "search_path=''"));
  assert.deepEqual(bad.map((r) => r.f), []);
});

test('every function in our schemas is closed to PUBLIC', async () => {
  const rows = await db.q<{ f: string }>(
    `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1)
       and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.grantee = 0 and a.privilege_type = 'EXECUTE')`, [SCHEMAS]);
  assert.deepEqual(rows, []);
});
