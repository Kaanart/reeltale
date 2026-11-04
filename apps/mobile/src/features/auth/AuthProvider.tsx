// Who is signed in, where their account stands (gate.ts), and the sign-in actions. One context with the
// same shape in both modes: LiveAuth talks to Supabase, DemoAuth keeps a fake account on the device.
//
// Live: the session comes from supabase-js (onAuthStateChange, which also delivers the stored session at
// start-up); the account row is the owner's public.profile_private (granted columns only, no date of
// birth); the role is rpc get_my_role, asked only for adults.

import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { checkDateOfBirth, isAgeOutcome, type AgeOutcome } from '../../core/age';
import { ApiError } from '../../core/api';
import { DEMO_ROLE, DEMO_USER_ID } from '../../demo/fixtures';
import { DEMO_ADULT, demoSession, type DemoAccountState } from '../../demo/session';
import { demoDelay } from '../../demo/state';
import { refreshSession } from '../../lib/api';
import { rpc, select } from '../../lib/data';
import { isDemo, isDemoSession, leaveWebDemo, takeWebDemoEntry } from '../../lib/env';
import {
  gateFor, isAgeStatus, isRole, TERMS_VERSION,
  type AccountState, type AgeStatus, type Gate, type Role, type SessionState, type SignInMethod,
} from '../../lib/gate';
import { authKeys } from '../../lib/keys';
import { clearUserData } from '../../lib/query';
import { getSupabase } from '../../lib/supabase';
import { ACCOUNT_COLUMNS, type AccountRow } from '../../lib/types';
import { signInProviders } from './providers';
import { isCompleteCode, isValidEmail, normalizeEmail, SignInUnavailable } from './validation';

export interface AuthActions {
  /** Email a 6-digit code (Supabase creates the account on first use). */
  sendEmailCode(email: string): Promise<void>;
  /** Check the code sent to `pendingEmail`. */
  verifyEmailCode(code: string): Promise<void>;
  /** Demo, judge and App Review accounts only. */
  signInWithPassword(email: string, password: string): Promise<void>;
  signInWithApple(): Promise<void>;
  signInWithGoogle(): Promise<void>;
  /** Demo mode only: straight in as an adult who has accepted the Terms. */
  enterDemo(): void;
  signOut(): Promise<void>;
  /** YYYY-MM-DD. Resolves 'adult' or 'blocked'; the gate moves on by itself. */
  setDateOfBirth(dob: string): Promise<AgeOutcome>;
  acceptTerms(): Promise<void>;
  /** Show or hide mature series (profile_private.mature_opt_in, adults only). For Settings. */
  setMatureOptIn(on: boolean): Promise<void>;
  /** Load the account row and role again (after a retry, or after Settings changed the mature opt-in). */
  reloadAccount(): Promise<void>;
}

export interface AuthContextValue {
  isDemo: boolean;
  gate: Gate;
  /** The signed-in user (null when signed out or not known yet). The only source of identity in the app. */
  userId: string | null;
  email: string | null;
  method: SignInMethod | null;
  ageStatus: AgeStatus | null;
  matureOptIn: boolean;
  role: Role;
  /** The address the last code went to (kept in memory, never in the URL). */
  pendingEmail: string | null;
  options: { apple: boolean; google: boolean };
  actions: AuthActions;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  return isDemo ? <DemoAuth>{children}</DemoAuth> : <LiveAuth>{children}</LiveAuth>;
}

/** Sign-in buttons this platform can show (Apple: iOS and web; Google: web for now). */
function useSignInOptions() {
  const [apple, setApple] = useState(false);
  useEffect(() => {
    let alive = true;
    void signInProviders.appleAvailable().then((ok) => { if (alive) setApple(ok); });
    return () => { alive = false; };
  }, []);
  return useMemo(() => ({ apple, google: signInProviders.googleAvailable }), [apple]);
}

function parseAccount(raw: unknown): AccountRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as AccountRow;
  return typeof row.user_id === 'string' && isAgeStatus(row.age_status) ? row : null;
}

function methodOf(session: Session | null): SignInMethod | null {
  if (!session) return null;
  const provider = session.user.app_metadata?.provider;
  return provider === 'apple' || provider === 'google' ? provider : 'email';
}

// ---- Live --------------------------------------------------------------------------------------------

function LiveAuth({ children }: { children: ReactNode }) {
  const client = getSupabase();
  const queryClient = useQueryClient();
  const options = useSignInOptions();
  // undefined until supabase-js has read the stored session.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const lastUser = useRef<string | null>(null);

  useEffect(() => {
    // Only state updates in here: calling supabase from inside this callback can deadlock its auth lock.
    const { data } = client.auth.onAuthStateChange((event, next) => {
      const nextUser = next?.user.id ?? null;
      if (event === 'SIGNED_OUT' || (lastUser.current !== null && nextUser !== lastUser.current)) clearUserData();
      lastUser.current = nextUser;
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  const userId = session?.user.id ?? null;

  const account = useQuery({
    queryKey: authKeys.profile(userId),
    enabled: !!userId,
    queryFn: async () => {
      const raw = await select<unknown>(
        client.from('profile_private').select(ACCOUNT_COLUMNS).eq('user_id', userId ?? '').maybeSingle(),
      );
      return raw === null ? null : parseAccount(raw);
    },
  });

  const ageStatus = account.data?.age_status ?? null;

  const role = useQuery({
    queryKey: authKeys.role(userId),
    enabled: !!userId && ageStatus === 'adult',
    // Anything unexpected counts as a plain user: never more rights than the database says.
    queryFn: () => rpc<Role>('get_my_role', undefined, (r) => (isRole(r) ? r : 'user')),
  });

  const sessionState: SessionState = session === undefined ? 'loading' : session ? 'present' : 'none';
  const accountState: AccountState =
    account.data !== undefined
      ? { status: 'ok', row: account.data && { ageStatus: account.data.age_status, tosVersion: account.data.tos_version } }
      : account.isError ? { status: 'error' } : { status: 'loading' };
  const gate = gateFor(sessionState, accountState);

  const reloadAccount = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: authKeys.profile(userId) });
    await queryClient.invalidateQueries({ queryKey: authKeys.role(userId) });
  }, [queryClient, userId]);

  const actions = useMemo<AuthActions>(() => ({
    async sendEmailCode(input) {
      const email = normalizeEmail(input);
      if (!isValidEmail(email)) throw new ApiError(400, 'email_address_invalid');
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      setPendingEmail(email);
    },
    async verifyEmailCode(code) {
      if (!pendingEmail) throw new ApiError(400, 'flow_state_not_found');
      if (!isCompleteCode(code)) throw new ApiError(400, 'otp_expired');
      const { error } = await client.auth.verifyOtp({ email: pendingEmail, token: code, type: 'email' });
      if (error) throw error;
    },
    async signInWithPassword(email, password) {
      const { error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error) throw error;
    },
    signInWithApple: () => signInProviders.signInWithApple(client),
    signInWithGoogle: () => signInProviders.signInWithGoogle(client),
    enterDemo() {
      // Live builds have no demo account.
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      clearUserData();
    },
    async setDateOfBirth(dob) {
      const check = checkDateOfBirth(dob);
      if (!check.ok) throw new ApiError(400, 'invalid_date_of_birth');
      const outcome = await rpc<AgeOutcome>('set_my_date_of_birth', { p_dob: check.dob }, (r) => (isAgeOutcome(r) ? r : null));
      // A new access token carries the new age_ok claim, which the Worker checks.
      await refreshSession().catch(() => false);
      await reloadAccount();
      return outcome;
    },
    async acceptTerms() {
      await rpc('accept_terms', { p_tos_version: TERMS_VERSION });
      await reloadAccount();
    },
    async setMatureOptIn(on) {
      if (!userId) throw new ApiError(401, 'not_authenticated');
      // RLS limits this to the owner's row, and the opt-in to adults.
      await select(client.from('profile_private').update({ mature_opt_in: on }).eq('user_id', userId));
      await reloadAccount();
    },
    reloadAccount,
  }), [client, pendingEmail, reloadAccount, userId]);

  const value = useMemo<AuthContextValue>(() => ({
    isDemo: false,
    gate,
    userId,
    email: session?.user.email ?? null,
    method: methodOf(session ?? null),
    ageStatus,
    matureOptIn: account.data?.mature_opt_in ?? false,
    role: role.data ?? 'user',
    pendingEmail,
    options,
    actions,
  }), [gate, userId, session, ageStatus, account.data, role.data, pendingEmail, options, actions]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---- Demo --------------------------------------------------------------------------------------------

function DemoAuth({ children }: { children: ReactNode }) {
  const options = useSignInOptions();
  const account = useSyncExternalStore(demoSession.subscribe, demoSession.get, demoSession.get);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    void demoSession.load().then(() => {
      // "Start watching free" on the live website: straight in, as the sample account.
      if (takeWebDemoEntry() && !demoSession.get()) demoSession.set(DEMO_ADULT);
    });
  }, []);

  // A sign-in other than "Explore the demo" starts like a new account, so the birthday and Terms steps show.
  const startNew = useCallback((email: string, method: SignInMethod) => {
    const next: DemoAccountState = { email, method, ageStatus: 'unknown', tosVersion: null, matureOptIn: false };
    demoSession.set(next);
  }, []);

  const actions = useMemo<AuthActions>(() => ({
    async sendEmailCode(input) {
      const email = normalizeEmail(input);
      if (!isValidEmail(email)) throw new ApiError(400, 'email_address_invalid');
      await demoDelay();
      setPendingEmail(email);
    },
    async verifyEmailCode(code) {
      if (!pendingEmail) throw new ApiError(400, 'flow_state_not_found');
      // Any six digits work in the demo.
      if (!isCompleteCode(code)) throw new ApiError(400, 'otp_expired');
      await demoDelay();
      startNew(pendingEmail, 'email');
    },
    async signInWithPassword(email, password) {
      if (!isValidEmail(email) || password.length === 0) throw new ApiError(400, 'invalid_credentials');
      await demoDelay();
      startNew(normalizeEmail(email), 'password');
    },
    async signInWithApple() {
      if (!options.apple) throw new SignInUnavailable();
      await demoDelay();
      startNew('apple@example.com', 'apple');
    },
    async signInWithGoogle() {
      if (!options.google) throw new SignInUnavailable();
      await demoDelay();
      startNew('google@example.com', 'google');
    },
    enterDemo() {
      demoSession.set(DEMO_ADULT);
    },
    async signOut() {
      demoSession.set(null);
      setPendingEmail(null);
      clearUserData();
      // A live website tab leaves the sample catalog altogether.
      if (isDemoSession) leaveWebDemo('/');
    },
    async setDateOfBirth(dob) {
      const check = checkDateOfBirth(dob);
      if (!check.ok) throw new ApiError(400, 'invalid_date_of_birth');
      await demoDelay();
      const outcome: AgeOutcome = check.adult ? 'adult' : 'blocked';
      demoSession.update({ ageStatus: outcome });
      return outcome;
    },
    async acceptTerms() {
      await demoDelay();
      demoSession.update({ tosVersion: TERMS_VERSION });
    },
    async setMatureOptIn(on) {
      demoSession.update({ matureOptIn: on });
    },
    async reloadAccount() {
      // Nothing to reload: the demo account is local.
    },
  }), [options, pendingEmail, startNew]);

  const sessionState: SessionState = account === undefined ? 'loading' : account ? 'present' : 'none';
  const gate = gateFor(sessionState, {
    status: 'ok',
    row: account ? { ageStatus: account.ageStatus, tosVersion: account.tosVersion } : null,
  });

  const value = useMemo<AuthContextValue>(() => ({
    isDemo: true,
    gate,
    userId: account ? DEMO_USER_ID : null,
    email: account?.email ?? null,
    method: account?.method ?? null,
    ageStatus: account?.ageStatus ?? null,
    matureOptIn: account?.matureOptIn ?? false,
    role: DEMO_ROLE,
    pendingEmail,
    options,
    actions,
  }), [gate, account, pendingEmail, options, actions]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
