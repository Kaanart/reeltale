import { useState } from 'react';
import { stickyGate, type Gate } from '../../lib/gate';

type SettledGate = Exclude<Gate, 'loading' | 'error'>;

/**
 * The gate to lay screens out for: the current one, or the last settled one while the account reloads
 * or can't be loaded (the overlay covers that). Null until the gate has settled once (cold start).
 */
export function useStickyGate(gate: Gate): SettledGate | null {
  const [last, setLast] = useState<SettledGate | null>(null);
  const settled = gate === 'loading' || gate === 'error' ? last : stickyGate(gate, last);
  // Remember it for the next reload ("derived state": React re-renders at once with the new value).
  if (settled !== last) setLast(settled);
  return settled;
}
