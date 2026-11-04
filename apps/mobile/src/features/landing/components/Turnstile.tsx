import { useEffect, useRef } from 'react';

// The Cloudflare Turnstile widget for the public notice form. Web only: nothing but NoticeScreen.web.tsx
// imports it, so the native apps never contain it. The script comes from challenges.cloudflare.com, the
// one external script origin the page's CSP allows (script-src and frame-src; apps/server/src/lib/http.ts).
//
// The redeem screen has its own widget with the action fixed to "redeem" (features/me/redeem/Turnstile.tsx).
// This one takes the action, because the Worker checks it: POST /api/report wants "report". Both load the
// same script once per page (whichever comes first), and share window.turnstile.

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

const SCRIPT_ORIGIN = 'https://challenges.cloudflare.com';
const SCRIPT_SRC = `${SCRIPT_ORIGIN}/turnstile/v0/api.js?render=explicit`;
const LOAD_TIMEOUT_MS = 20_000;
let loading: Promise<TurnstileApi> | null = null;

function api(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

function loadScript(): Promise<TurnstileApi> {
  const ready = api();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    // The redeem screen may have added the tag already: wait for that one instead of adding a second.
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_ORIGIN}/turnstile/"]`);
    const el = existing ?? document.createElement('script');
    // A tag that never loads (blocked, or one that failed before we came) must not leave the form waiting.
    const timer = setTimeout(() => fail(), LOAD_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      const loaded = api();
      if (loaded) resolve(loaded);
      else fail();
    };
    const fail = () => {
      clearTimeout(timer);
      loading = null; // a later visit may try again
      if (!existing) el.remove();
      reject(new Error('turnstile_unavailable'));
    };
    el.addEventListener('load', done, { once: true });
    el.addEventListener('error', fail, { once: true });
    if (!existing) {
      el.src = SCRIPT_SRC;
      el.async = true;
      document.head.appendChild(el);
    }
  });
  return loading;
}

export interface TurnstileHandle {
  /** Ask for a fresh token (a token works once). */
  reset: () => void;
}

export interface TurnstileProps {
  siteKey: string;
  /** The action the Worker expects ('report' for POST /api/report). */
  action: string;
  /** Called with a token when the check passes. */
  onToken: (token: string) => void;
  /** Called when the token expires or the check has to run again: the old token is no good. */
  onInvalid: () => void;
  /** Called when the widget can't load or errors out. */
  onError: () => void;
  handle?: { current: TurnstileHandle | null };
  /** Names the widget's box for screen readers. */
  label: string;
}

export function Turnstile({ siteKey, action, onToken, onInvalid, onError, handle, label }: TurnstileProps) {
  const box = useRef<HTMLDivElement>(null);
  // The callbacks change on every render; the widget is made once and calls the latest ones.
  const latest = useRef({ onToken, onInvalid, onError });
  latest.current = { onToken, onInvalid, onError };

  useEffect(() => {
    let widgetId: string | null = null;
    let turnstile: TurnstileApi | null = null;
    let cancelled = false;

    loadScript()
      .then((loaded) => {
        if (cancelled || !box.current) return;
        turnstile = loaded;
        widgetId = loaded.render(box.current, {
          sitekey: siteKey,
          action,
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => latest.current.onToken(token),
          'expired-callback': () => latest.current.onInvalid(),
          'timeout-callback': () => latest.current.onInvalid(),
          'error-callback': () => latest.current.onError(),
        });
        if (handle) handle.current = { reset: () => { if (widgetId) loaded.reset(widgetId); } };
      })
      .catch(() => {
        if (!cancelled) latest.current.onError();
      });

    return () => {
      cancelled = true;
      if (handle) handle.current = null;
      if (turnstile && widgetId) turnstile.remove(widgetId);
    };
  }, [siteKey, action, handle]);

  return <div ref={box} role="group" aria-label={label} />;
}
