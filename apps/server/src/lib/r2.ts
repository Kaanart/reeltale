// Hard monthly limits on R2 use (supabase/migrations/20261104090000_r2_limits.sql). Every R2 read and write is
// reserved in Postgres first; over a cap the reservation throws DbError('storage_budget_exceeded') and the R2 call
// is never made, so the account stays inside the free tier.

import type { Env } from '../env.ts';
import { serviceDb } from './db.ts';

/** Reserve one read (class B). */
export function reserveRead(env: Env): Promise<void> {
  return serviceDb(env).rpc('r2_reserve', { p_class: 'b', p_bytes: 0 });
}

/** Reserve one write (class A) of this many bytes. */
export function reserveWrite(env: Env, data: string | Uint8Array): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
  return serviceDb(env).rpc('r2_reserve', { p_class: 'a', p_bytes: bytes });
}

/** Whether there is room for one more AI scene this month. */
export async function r2HasRoom(env: Env): Promise<boolean> {
  return (await serviceDb(env).rpc<boolean>('r2_has_room', {})) === true;
}
