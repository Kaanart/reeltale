// Test harness: a fresh in-memory Postgres (PGlite) with Supabase stand-ins and every migration
// applied. Lets the SQL be tested without Docker. Re-run the same assertions against real local
// Supabase (pgTAP) once Docker is available.

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const seedFile = join(here, '..', 'seed.sql');
const seedsDir = join(here, '..', 'seeds');

export type Row = Record<string, unknown>;

export class TestDb {
  readonly pg: PGlite;

  constructor(pg: PGlite) {
    this.pg = pg;
  }

  /** Run as the database owner (migrations, cron jobs). */
  async asPostgres(): Promise<void> {
    await this.pg.exec('reset role');
    await this.pg.query(`select set_config('request.jwt.claims', '', false)`);
  }

  /** Run as a signed-in user, the way PostgREST does it. */
  async asUser(userId: string): Promise<void> {
    await this.asPostgres();
    await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await this.pg.exec('set role authenticated');
  }

  /** Run as the Worker with the secret key. */
  async asService(): Promise<void> {
    await this.asPostgres();
    await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);
    await this.pg.exec('set role service_role');
  }

  async asAnon(): Promise<void> {
    await this.asPostgres();
    await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'anon' })]);
    await this.pg.exec('set role anon');
  }

  async q<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.q<T>(sql, params);
    if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}: ${sql}`);
    return rows[0];
  }

  /** Expect the statement to fail with a message matching `pattern`. Returns the message. */
  async fails(sql: string, params: unknown[], pattern: RegExp): Promise<string> {
    try {
      await this.pg.query(sql, params);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!pattern.test(msg)) throw new Error(`failed with "${msg}", expected ${pattern}`);
      return msg;
    }
    throw new Error(`expected failure ${pattern}, but it succeeded: ${sql}`);
  }

  /** Create an auth user (as Supabase Auth would). Returns its id. */
  async createUser(email: string): Promise<string> {
    await this.asPostgres();
    const row = await this.one<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
    return row.id;
  }

  /** Create a user who declared an adult date of birth. */
  async createAdult(email: string): Promise<string> {
    const id = await this.createUser(email);
    await this.asUser(id);
    const r = await this.one<{ s: string }>('select public.set_my_date_of_birth($1::date) as s', ['1990-05-01']);
    if (r.s !== 'adult') throw new Error('expected adult');
    await this.asPostgres();
    return id;
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

export async function freshDb(options: { seed?: boolean } = {}): Promise<TestDb> {
  const pg = await PGlite.create({ extensions: { citext, pg_trgm } });
  await pg.exec(readFileSync(join(here, 'supabase-stubs.sql'), 'utf8'));
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    try {
      await pg.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (options.seed) {
    // Same order as supabase/config.toml [db.seed] sql_paths: seed.sql, then seeds/*.sql.
    const seeds = [seedFile, ...readdirSync(seedsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => join(seedsDir, f))];
    for (const f of seeds) {
      try {
        await pg.exec(readFileSync(f, 'utf8'));
      } catch (e) {
        throw new Error(`seed ${f} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return new TestDb(pg);
}
