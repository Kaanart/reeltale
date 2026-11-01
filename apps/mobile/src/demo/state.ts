// In-memory state for demo mode: what a demo action changes (coins spent, episodes unlocked, follows …).
// Lives until sign-out or reload; nothing is saved and nothing leaves the device.
//
//   const wallet = demoState('wallet', () => demoWallet());
//   wallet.set((w) => ({ ...w, balance: w.balance - price }));   // then invalidate the query as usual
//
// Names are global, so prefix them with your feature: 'watch.unlocks', 'catalog.follows'.

const cells = new Map<string, { value: unknown; initial: () => unknown }>();

export interface DemoCell<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
}

export function demoState<T>(name: string, initial: () => T): DemoCell<T> {
  const cell = () => {
    let c = cells.get(name);
    if (!c) {
      c = { value: initial(), initial };
      cells.set(name, c);
    }
    return c;
  };
  return {
    get: () => cell().value as T,
    set: (next) => {
      const c = cell();
      c.value = typeof next === 'function' ? (next as (prev: T) => T)(c.value as T) : next;
    },
  };
}

/** Back to the fixtures. Called on demo sign-out. */
export function resetDemoState(): void {
  cells.clear();
}

/** A short wait, so demo loads show their loading state the way real ones do. */
export const DEMO_LATENCY_MS = 150;

export function demoDelay(ms: number = DEMO_LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
