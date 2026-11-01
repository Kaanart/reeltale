// The accounts the signed-in person has blocked (public.blocks: owner-only rows). The Blocked accounts list
// is the one place to undo a block: a blocked profile is hidden from the person who blocked it (see
// profile_is_listed in the trust migration), so no profile page can offer "Unblock". For the same reason
// the list shows no names, only when each block was made.

export interface BlockRow {
  blocked_id: string;
  created_at: string | null;
}

/** Granted columns of public.blocks that the list reads (the blocker is always the signed-in person). */
export const BLOCK_COLUMNS = 'blocked_id, created_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function time(row: BlockRow): number {
  const t = row.created_at ? new Date(row.created_at).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/** `unknown` in, rows out (newest first; undated ones last); null when it isn't a list. Odd rows are dropped. */
export function parseBlocks(raw: unknown): BlockRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: BlockRow[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.blocked_id !== 'string' || !UUID.test(r.blocked_id)) continue;
    rows.push({ blocked_id: r.blocked_id.toLowerCase(), created_at: typeof r.created_at === 'string' ? r.created_at : null });
  }
  return rows.sort((a, b) => time(b) - time(a));
}

/** Is this account on the list? Ids compare in lower case. */
export function isBlockedIn(rows: readonly BlockRow[], id: string): boolean {
  const want = id.toLowerCase();
  return rows.some((r) => r.blocked_id === want);
}
