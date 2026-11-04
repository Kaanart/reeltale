// R2 limits (supabase/migrations/20261104090000_r2_limits.sql): every R2 call is reserved first, refused over the
// monthly caps, and a refused reservation counts nothing. Only the Worker (service role) can reserve.

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

async function cap(key: string, value: number) {
  await db.asPostgres();
  await db.q(`update public.pricing_config set value = to_jsonb($2::int) where key = $1`, [key, value]);
}
async function usage() {
  await db.asPostgres();
  const u = await db.one<{ a: string | null; b: string | null; bytes: string }>(
    `select (select class_a from app_private.r2_usage_monthly order by month desc limit 1)::text as a,
            (select class_b from app_private.r2_usage_monthly order by month desc limit 1)::text as b,
            (select bytes from app_private.r2_storage)::text as bytes`,
  );
  return { a: Number(u.a ?? 0), b: Number(u.b ?? 0), bytes: Number(u.bytes) };
}
async function reserve(cls: string, bytes = 0) {
  await db.asService();
  await db.q('select svc.r2_reserve($1, $2)', [cls, bytes]);
}
async function hasRoom() {
  await db.asService();
  return (await db.one<{ ok: boolean }>('select svc.r2_has_room() as ok')).ok;
}

test('writes and reads are counted and refused over the monthly cap, without counting the refusal', async () => {
  await cap('r2_class_a_per_month', 3);
  await cap('r2_class_b_per_month', 2);
  const start = await usage();
  for (let i = 0; i < 3 - start.a; i++) await reserve('a', 10);
  await assert.rejects(reserve('a', 10), /storage_budget_exceeded/);
  for (let i = 0; i < 2 - start.b; i++) await reserve('b');
  await assert.rejects(reserve('b'), /storage_budget_exceeded/);
  const end = await usage();
  assert.equal(end.a, 3);
  assert.equal(end.b, 2);
  assert.equal(await hasRoom(), false);
  await cap('r2_class_a_per_month', 800000);
  await cap('r2_class_b_per_month', 8000000);
  assert.equal(await hasRoom(), true);
});

test('stored bytes have a cap; a write over it is refused and its operation is not counted', async () => {
  await cap('r2_stored_mb_cap', 1);
  const before = await usage();
  await reserve('a', 1048576 - before.bytes);
  await assert.rejects(reserve('a', 1), /storage_budget_exceeded/);
  const after = await usage();
  assert.equal(after.bytes, 1048576);
  assert.equal(after.a, before.a + 1, 'the refused write did not count as an operation');
  assert.equal(await hasRoom(), false, 'no room for another scene');
  await cap('r2_stored_mb_cap', 8000);
  assert.equal(await hasRoom(), true);
});

test('bad input is refused, and only the service role may reserve', async () => {
  await assert.rejects(reserve('c'), /invalid_amount/);
  await assert.rejects(reserve('a', -1), /invalid_amount/);
  await assert.rejects(reserve('b', 5), /invalid_amount/, 'reads store nothing');
  const u = await db.createAdult(`r2-${Date.now().toString(36)}@example.com`);
  await db.asUser(u);
  await assert.rejects(db.q(`select svc.r2_reserve('a', 1)`), /permission denied/);
  await assert.rejects(db.q('select svc.r2_has_room()'), /permission denied/);
});
