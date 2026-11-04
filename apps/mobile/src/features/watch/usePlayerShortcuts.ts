// The player's letter and Space keys (logic/desktop.ts shortcutFor). Keyboards are a web thing here: in the
// apps this does nothing. usePlayerShortcuts.web.ts is the browser version.

import type { PlayerShortcut } from './logic/desktop';

export type ShortcutHandlers = Record<PlayerShortcut, () => void>;

export function usePlayerShortcuts(_enabled: boolean, _handlers: ShortcutHandlers): void {
  // Nothing to listen to in the native apps.
}
