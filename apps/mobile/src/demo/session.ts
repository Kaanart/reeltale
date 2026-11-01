// The demo-mode "session": a fake account kept on this device (AsyncStorage, which is localStorage on the
// web), so a reload doesn't sign the judge out. No token, no network. Only src/features/auth reads and
// writes it; everything else asks useAuth().

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAgeStatus, TERMS_VERSION, type AgeStatus, type SignInMethod } from '../lib/gate';
import { DEMO_EMAIL } from './fixtures';
import { resetDemoState } from './state';

export interface DemoAccountState {
  email: string;
  method: SignInMethod;
  ageStatus: AgeStatus;
  tosVersion: string | null;
  matureOptIn: boolean;
}

/** "Explore the demo": an adult who has accepted the Terms, straight into the app. */
export const DEMO_ADULT: DemoAccountState = {
  email: DEMO_EMAIL, method: 'demo', ageStatus: 'adult', tosVersion: TERMS_VERSION, matureOptIn: false,
};

const STORAGE_KEY = 'reeltale.demo.account.v1';
const METHODS: readonly SignInMethod[] = ['email', 'password', 'apple', 'google', 'demo'];

// undefined = not read from storage yet; null = signed out.
let current: DemoAccountState | null | undefined;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function parse(raw: string | null): DemoAccountState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DemoAccountState>;
    if (typeof v.email !== 'string' || !METHODS.includes(v.method as SignInMethod) || !isAgeStatus(v.ageStatus)) return null;
    return {
      email: v.email,
      method: v.method as SignInMethod,
      ageStatus: v.ageStatus,
      tosVersion: typeof v.tosVersion === 'string' ? v.tosVersion : null,
      matureOptIn: v.matureOptIn === true,
    };
  } catch {
    return null;
  }
}

async function persist(next: DemoAccountState | null) {
  try {
    if (next) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private window): the demo still works for this visit.
  }
}

export const demoSession = {
  /** For useSyncExternalStore. */
  get: (): DemoAccountState | null | undefined => current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  load(): Promise<void> {
    loading ??= (async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        raw = null;
      }
      if (current === undefined) current = parse(raw);
      emit();
    })();
    return loading;
  },
  set(next: DemoAccountState | null): void {
    if (!next) resetDemoState();
    current = next;
    emit();
    void persist(next);
  },
  update(patch: Partial<DemoAccountState>): void {
    if (current) demoSession.set({ ...current, ...patch });
  },
};
