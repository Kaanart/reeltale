// The story player's keys on the web: Space, the arrows, 1 2 3 (logic.ts playerShortcut decides). Listens on the
// document only while this screen is focused, so a player further down the stack never hears them.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { playerShortcut, type KeyPress, type PlayerShortcut } from './logic';

function targetOf(event: KeyboardEvent): KeyPress['target'] {
  const el = event.target;
  if (!(el instanceof Element)) return null;
  return {
    tag: el.tagName.toUpperCase(),
    role: el.getAttribute('role'),
    editable: el instanceof HTMLElement && el.isContentEditable,
  };
}

export function useKeyboardShortcuts(onShortcut: (shortcut: PlayerShortcut) => boolean, enabled: boolean = true): void {
  // The latest handler, without re-adding the listener on every render.
  const handler = useRef(onShortcut);
  useEffect(() => {
    handler.current = onShortcut;
  }, [onShortcut]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || typeof document === 'undefined') return undefined;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        const shortcut = playerShortcut({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          repeat: event.repeat,
          target: targetOf(event),
          inDialog: document.querySelector('[aria-modal="true"]') !== null,
        });
        if (shortcut && handler.current(shortcut)) event.preventDefault();
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }, [enabled]),
  );
}
