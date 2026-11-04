// What screens tell the web shell, kept outside React so it is testable (src/core/__tests__/layout.test.ts):
//   - page titles: the focused screen's title wins; without one the shell uses the tab's name or the app name
//   - "hide the top bar": screens that need the whole window (a full-screen player) ask while focused
// Entries are added when a screen gains focus and removed when it loses it (usePageTitle / useHideTopNav),
// so the newest entry is the focused screen's.

type Listener = () => void;

export interface ShellSnapshot {
  /** The focused screen's page title, or null when no screen set one. */
  title: string | null;
  /** True while any focused screen asked for the top bar to be hidden. */
  topNavHidden: boolean;
}

export interface ShellStore {
  /** Adds a page title; returns the function that removes it again. */
  pushTitle(title: string): () => void;
  /** Hides the top bar until the returned function is called. */
  hideTopNav(): () => void;
  get(): ShellSnapshot;
  subscribe(listener: Listener): () => void;
}

export function createShellStore(): ShellStore {
  let nextId = 1;
  let titles: { id: number; title: string }[] = [];
  const hiders = new Set<number>();
  const listeners = new Set<Listener>();
  let snapshot: ShellSnapshot = { title: null, topNavHidden: false };

  const emit = () => {
    const title = titles.length > 0 ? titles[titles.length - 1]!.title : null;
    const topNavHidden = hiders.size > 0;
    if (title === snapshot.title && topNavHidden === snapshot.topNavHidden) return;
    snapshot = { title, topNavHidden };
    for (const listener of [...listeners]) listener();
  };

  return {
    pushTitle(title) {
      const id = nextId++;
      titles = [...titles, { id, title }];
      emit();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        titles = titles.filter((t) => t.id !== id);
        emit();
      };
    },
    hideTopNav() {
      const id = nextId++;
      hiders.add(id);
      emit();
      return () => {
        if (hiders.delete(id)) emit();
      };
    },
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one store (the shell reads it, screens write to it through the hooks). */
export const shellStore = createShellStore();
