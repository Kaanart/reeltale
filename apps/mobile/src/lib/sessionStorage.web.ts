// Web: supabase-js's own default storage (localStorage). There is no secure store in the browser; the CSP
// (scripts from our origin only) is what keeps the session safe there.

import type { StringStore } from './encryptedStorage';

export const nativeSessionStorage: StringStore | undefined = undefined;
