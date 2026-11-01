// How the rest of the app asks about the signed-in user. Identity only ever comes from here (the session),
// never from a route param or a text field.

import { useContext } from 'react';
import type { Role } from '../../lib/gate';
import { AuthContext, type AuthActions, type AuthContextValue } from './AuthProvider';

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider> (src/app/_layout.tsx).');
  return value;
}

export function useAuthActions(): AuthActions {
  return useAuth().actions;
}

/** The signed-in user's id, for query keys (`userKey(userId, ...)`) and `enabled: !!userId`. */
export function useUserId(): string | null {
  return useAuth().userId;
}

/** 'user' until get_my_role says otherwise. Editor screens show only for 'editor' and 'admin'. */
export function useRole(): Role {
  return useAuth().role;
}

export function useIsEditor(): boolean {
  const role = useRole();
  return role === 'editor' || role === 'admin';
}
