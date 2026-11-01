// Errors for the Me screens: one place that turns whatever was thrown into an i18n key and its numbers.
// Server text never reaches the user (core/errors.ts maps codes to strings we wrote).

import { describeError, errorCodeOf } from '../../../core/errors.ts';

export interface ErrorTextValue {
  key: string;
  params: { count?: number };
}

export function errorText(err: unknown): ErrorTextValue {
  const info = describeError(err);
  return { key: info.key, params: info.params };
}

/**
 * Blocking someone who can't be found. The database answers `user_not_found` (the same for a missing and a
 * hidden account); the generic table reads that code as a sign-in problem, which would be wrong here.
 */
export function blockErrorText(err: unknown): ErrorTextValue {
  if (errorCodeOf(err).code === 'user_not_found') return { key: 'profile:user.notFound', params: {} };
  return errorText(err);
}
