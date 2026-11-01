// Query keys. Pure (tested in src/core/__tests__/retry.test.ts).
//
// Everything the app loads depends on who is signed in (RLS: mature opt-in, blocks, unlocks, owner-only
// rows), so every key starts with the user: ['u', userId, <feature>, ...]. Data of one account can then
// never show up for another, and sign-out simply clears the whole cache.
//
//   useQuery({ queryKey: userKey(userId, 'catalog', 'series', seriesId), enabled: !!userId, ... })
//   queryClient.invalidateQueries({ queryKey: userKey(userId, 'wallet') })

export type KeyPart = string | number | boolean | null | Readonly<Record<string, string | number | boolean | null>>;

export const USER_SCOPE = 'u';

/** ['u', userId, ...parts]. A missing user gives 'signed-out', which no enabled query should ever use. */
export function userKey(userId: string | null | undefined, ...parts: KeyPart[]): readonly unknown[] {
  return [USER_SCOPE, userId ?? 'signed-out', ...parts];
}

/** Keys the auth feature owns. Settings invalidates `profile` after changing the mature opt-in. */
export const authKeys = {
  profile: (userId: string | null | undefined) => userKey(userId, 'auth', 'profile'),
  role: (userId: string | null | undefined) => userKey(userId, 'auth', 'role'),
};
