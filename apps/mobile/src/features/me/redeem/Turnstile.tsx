import { useEffect, useRef } from 'react';

// The Cloudflare Turnstile widget for the redeem screen. Web only: this file is imported by nothing but the
// web redeem screen, so the native apps never contain it. The script comes from challenges.cloudflare.com
// (the page's CSP allows exactly that origin for scripts and frames). The widget runs with the action
// "redeem", which the Worker checks when it verifies the token.

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile_unavailable')));
    el.onerror = () => {
      scriptLoading = null; // a later visit may try again
      reject(new Error('turnstile_unavailable'));
    };
    document.head.appendChild(el);
  });
  return scriptLoading;
}

export interface TurnstileHandle {
  /** Ask for a fresh token (a token works once). */
  reset: () => void;
}

export interface TurnstileProps {
  siteKey: string;
  /** Called with a token when the check passes. */
  onToken: (token: string) => void;
  /** Called when the token expires or the check fails: the old token is no good. */
  onInvalid: () => void;
  /** Called when the widget can't load or errors out. */
  onError: () => void;
  handle?: { current: TurnstileHandle | null };
  label: string;
}

export function Turnstile({ siteKey, onToken, onInvalid, onError, handle, label }: TurnstileProps) {
  const box = useRef<HTMLDivElement>(null);
  // The callbacks change on every render; the widget is made once and calls the latest ones.
  const latest = useRef({ onToken, onInvalid, onError });
  latest.current = { onToken, onInvalid, onError };

  useEffect(() => {
    let widgetId: string | null = null;
    let api: TurnstileApi | null = null;
    let cancelled = false;

    loadScript()
      .then((turnstile) => {
        if (cancelled || !box.current) return;
        api = turnstile;
        widgetId = turnstile.render(box.current, {
          sitekey: siteKey,
          action: 'redeem',
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => latest.current.onToken(token),
          'expired-callback': () => latest.current.onInvalid(),
          'error-callback': () => latest.current.onError(),
        });
        if (handle) handle.current = { reset: () => { if (widgetId) turnstile.reset(widgetId); } };
      })
      .catch(() => {
        if (!cancelled) latest.current.onError();
      });

    return () => {
      cancelled = true;
      if (handle) handle.current = null;
      if (api && widgetId) api.remove(widgetId);
    };
  }, [siteKey, handle]);

  return <div ref={box} role="group" aria-label={label} />;
}
