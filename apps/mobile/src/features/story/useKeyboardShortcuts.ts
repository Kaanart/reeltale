// The story player's keyboard shortcuts (logic.ts playerShortcut). The native apps have none: this is a no-op
// there, and useKeyboardShortcuts.web.ts listens on the web.

import type { PlayerShortcut } from './logic';

/**
 * Calls `onShortcut` for the player's keys while the screen is focused and `enabled` is true. Return true from
 * it when the key was used (the browser's default, such as Space scrolling the page, is then prevented).
 */
export function useKeyboardShortcuts(_onShortcut: (shortcut: PlayerShortcut) => boolean, _enabled: boolean = true): void {
  // Nothing to do in the native apps.
}
