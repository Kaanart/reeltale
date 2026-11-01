// Saves watch progress for one episode while it plays: throttled (logic/progress.ts ProgressThrottle), and
// right away on pause, at the end, when the app goes to the background and when the page leaves the window.
// Best effort: a failed save is dropped (the next one carries the newer position anyway) and never logged.

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useSaveProgress } from './hooks';
import { ProgressThrottle } from './logic/progress';

export function useProgressSaver(episodeId: string, seriesId: string, durationHint: number | null) {
  const save = useSaveProgress();
  const throttle = useRef(new ProgressThrottle());
  const latest = useRef({ position: 0, duration: durationHint ?? 0 });

  const push = useCallback((force: boolean) => {
    const { position, duration } = latest.current;
    const row = throttle.current.next(position, duration, Date.now(), force);
    if (row) save(episodeId, seriesId, row).catch(() => undefined);
  }, [episodeId, seriesId, save]);

  const onProgress = useCallback((positionSeconds: number, durationSeconds: number) => {
    latest.current = { position: positionSeconds, duration: durationSeconds > 0 ? durationSeconds : latest.current.duration };
    push(false);
  }, [push]);

  const flush = useCallback(() => push(true), [push]);

  // Leaving the window (unmount) and going to the background both save at once.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  return { onProgress, flush };
}
