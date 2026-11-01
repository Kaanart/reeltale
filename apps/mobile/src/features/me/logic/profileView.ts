// What the Me tab shows for the signed-in person (public.profiles: display name, handle, bio). The avatar is
// a placeholder until photos exist.

import type { ProfileRow } from '../../../lib/types.ts';

function clean(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

export function displayNameOf(profile: Pick<ProfileRow, 'display_name' | 'handle'> | null | undefined): string | null {
  return clean(profile?.display_name) ?? clean(profile?.handle);
}

export function handleText(profile: Pick<ProfileRow, 'handle'> | null | undefined): string | null {
  const handle = clean(profile?.handle);
  return handle ? `@${handle}` : null;
}

/** One upper-case letter for the placeholder avatar, or '' when there is no name yet. */
export function initialOf(profile: Pick<ProfileRow, 'display_name' | 'handle'> | null | undefined): string {
  const name = displayNameOf(profile);
  return name ? (Array.from(name)[0] ?? '').toUpperCase() : '';
}
