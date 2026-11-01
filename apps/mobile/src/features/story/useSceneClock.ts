// The scene clock of the living-comic player: where playback is (ms), whether it runs, and controls.
// Ticks a few times a second, which is all the text reveal needs; the Ken Burns zoom runs on the UI
// thread (react-native-reanimated) and only restarts when `epoch` changes (play, pause, seek, replay).
// Pauses by itself when the app goes to the background or the screen loses focus.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { clockPosition } from './logic';

const TICK_MS = 100;

export interface SceneClock {
  positionMs: number;
  playing: boolean;
  ended: boolean;
  /** Changes whenever the clock jumps or starts/stops, so animations can resync. */
  epoch: number;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  replay: () => void;
}

export function useSceneClock(totalMs: number): SceneClock {
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const base = useRef(0);
  const startedAt = useRef<number | null>(null);

  const now = () => Date.now();
  const current = useCallback(() => clockPosition(base.current, startedAt.current, now(), totalMs), [totalMs]);

  const stopAt = useCallback((ms: number) => {
    base.current = ms;
    startedAt.current = null;
    setPositionMs(ms);
    setPlaying(false);
    setEpoch((e) => e + 1);
  }, []);

  const runFrom = useCallback((ms: number) => {
    base.current = ms;
    startedAt.current = now();
    setPositionMs(ms);
    setPlaying(true);
    setEpoch((e) => e + 1);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const p = current();
      if (p >= totalMs) stopAt(totalMs);
      else setPositionMs(p);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, totalMs, current, stopAt]);

  const play = useCallback(() => {
    const p = current();
    runFrom(p >= totalMs ? 0 : p);
  }, [current, runFrom, totalMs]);

  const pause = useCallback(() => {
    if (startedAt.current === null) return;
    stopAt(current());
  }, [current, stopAt]);

  const seek = useCallback((ms: number) => {
    const to = Math.min(totalMs, Math.max(0, ms));
    if (to >= totalMs || startedAt.current === null) stopAt(to);
    else runFrom(to);
  }, [runFrom, stopAt, totalMs]);

  const replay = useCallback(() => runFrom(0), [runFrom]);

  // Leaving the app or the screen pauses; coming back leaves it paused, so nothing is missed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') pause();
    });
    return () => sub.remove();
  }, [pause]);
  useFocusEffect(useCallback(() => () => pause(), [pause]));

  return { positionMs, playing, ended: positionMs >= totalMs, epoch, play, pause, seek, replay };
}
