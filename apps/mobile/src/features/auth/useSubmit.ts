import { useCallback, useRef, useState } from 'react';
import { signInErrorText, type ErrorText } from './validation';

/**
 * Runs one sign-in step at a time: tracks which action is busy and turns a failure into the message to
 * show (a cancelled Apple sheet shows nothing). Ignores taps while a step is running.
 */
export function useSubmit<K extends string>() {
  const [busy, setBusy] = useState<K | null>(null);
  const [error, setError] = useState<ErrorText | null>(null);
  const running = useRef(false);

  const run = useCallback(async (which: K, step: () => Promise<unknown>): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(which);
    setError(null);
    try {
      await step();
      return true;
    } catch (err) {
      setError(signInErrorText(err));
      return false;
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, []);

  return { busy, error, setError, run };
}
