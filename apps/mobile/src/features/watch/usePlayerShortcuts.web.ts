// The player's letter and Space keys in a browser: K or Space plays and pauses, M mutes, C switches captions
// (logic/desktop.ts shortcutFor). The arrows, Page Up/Down, Home and End stay with the pager
// (components/EpisodePager.web.tsx). Same signature as usePlayerShortcuts.ts.

import { useEffect, useRef } from 'react';

import { shortcutFor } from './logic/desktop';
import type { ShortcutHandlers } from './usePlayerShortcuts';

export type { ShortcutHandlers } from './usePlayerShortcuts';

const CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="switch"], '
  + '[role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"]';

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function onControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROL) !== null;
}

/** Listens while `enabled` (the player in front, no sheet or end card open). */
export function usePlayerShortcuts(enabled: boolean, handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || typingInto(e.target)) return;
      const action = shortcutFor(e.key, { onControl: onControl(e.target) });
      if (!action) return;
      // Space would also scroll the page (or the pager) by a screen.
      e.preventDefault();
      if (!e.repeat) latest.current[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
