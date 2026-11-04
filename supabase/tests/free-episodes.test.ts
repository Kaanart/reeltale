// The first 10 episodes of a series are free by default (20261104090100_free_episodes.sql).

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

test('new series default to 10 free episodes, in the table and in the studio function', async () => {
  await db.asPostgres();
  const col = await db.one<{ d: string }>(
    `select column_default as d from information_schema.columns
     where table_schema = 'public' and table_name = 'series' and column_name = 'free_episode_count'`,
  );
  assert.equal(col.d, '10');
  const fn = await db.one<{ args: string }>(
    `select pg_get_function_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'studio_create_series'`,
  );
  assert.match(fn.args, /p_free_episode_count integer DEFAULT 10/);
});
