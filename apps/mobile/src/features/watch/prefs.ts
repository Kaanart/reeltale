// The viewer's sound and caption choices, kept for the rest of the session: they carry over from episode to
// episode and from one series to the next, and reset when the app restarts.

import { create } from 'zustand';

interface WatchPrefs {
  muted: boolean;
  captions: boolean;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  toggleCaptions: () => void;
}

export const useWatchPrefs = create<WatchPrefs>((set) => ({
  muted: false,
  captions: false,
  setMuted: (muted) => set({ muted }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  toggleCaptions: () => set((s) => ({ captions: !s.captions })),
}));
