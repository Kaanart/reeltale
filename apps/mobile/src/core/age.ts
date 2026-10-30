// Date-of-birth rules for the 18+ gate. They mirror public.set_my_date_of_birth
// (supabase/migrations/20261027090100_accounts.sql), which is the real gate; this file only lets the
// birthday screen say "no" before a round trip, and explain why.
//
// The database rules, in order:
//   1. null, before 1900-01-01 or after current_date  -> invalid_date_of_birth
//   2. adult  <=>  dob <= (current_date - interval '18 years')::date
// current_date is the database's calendar date, which on Supabase is UTC. So "today" here is the UTC
// date of the device clock. If the device clock is wrong the server still decides.
//
// Postgres subtracts years by month arithmetic and then clamps the day to the end of the month:
// 2028-02-29 minus 18 years is 2010-02-28. A person born on Feb 29 therefore turns 18 on Mar 1 in a
// common year (the cutoff for Feb 28 is Feb 28, which is before their birthday) and on Feb 29 in a leap year.

export const ADULT_AGE = 18;
/** The earliest date of birth the database accepts. */
export const EARLIEST_DOB = '1900-01-01';
const EARLIEST: DateParts = { year: 1900, month: 1, day: 1 };
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isRealDate(p: DateParts): boolean {
  return Number.isInteger(p.year) && Number.isInteger(p.month) && Number.isInteger(p.day)
    && p.year >= 1 && p.year <= 9999 && p.month >= 1 && p.month <= 12
    && p.day >= 1 && p.day <= daysInMonth(p.year, p.month);
}

/** Orders dates: smaller key = earlier day. */
function key(p: DateParts): number {
  return p.year * 10_000 + p.month * 100 + p.day;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** `YYYY-MM-DD`, the format Postgres `date` and the RPC take. */
export function formatDateParts(p: DateParts): string {
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/**
 * Strict parse of `YYYY-MM-DD` into a real calendar date (Feb 30 and month 13 are refused, Feb 29 only
 * in leap years). Surrounding spaces are ignored; anything else returns null.
 */
export function parseDateOfBirth(text: string): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isRealDate(parts) ? parts : null;
}

/** Today's calendar date in UTC, the database's `current_date`. */
export function utcToday(now: Date): DateParts {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

/**
 * The calendar date a date picker shows. Pickers return a Date at local midnight, so read the local
 * fields, not the UTC ones (UTC would shift the day for anyone east of Greenwich).
 */
export function partsFromLocalDate(d: Date): DateParts {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * The latest date of birth that counts as an adult today: `today` minus 18 years, with the day clamped
 * to the end of that month (the same as Postgres).
 */
export function adultCutoff(today: DateParts): DateParts {
  const year = today.year - ADULT_AGE;
  return { year, month: today.month, day: Math.min(today.day, daysInMonth(year, today.month)) };
}

/**
 * Is someone born on `dob` 18 or older on `today` (default: the UTC date of now)? Only the age rule:
 * a future or pre-1900 date of birth is rejected by checkDateOfBirth, not here.
 */
export function isAdult(dob: DateParts | string, today: DateParts | Date = new Date()): boolean {
  const born = typeof dob === 'string' ? parseDateOfBirth(dob) : dob;
  if (!born || !isRealDate(born)) return false;
  const day = today instanceof Date ? utcToday(today) : today;
  return key(born) <= key(adultCutoff(day));
}

/** Why a typed date of birth is refused. Each maps to an `age.errors.*` string. */
export type DobProblem = 'invalid_format' | 'invalid_date' | 'too_old' | 'in_future';

export type DobCheck =
  | { ok: true; dob: string; adult: boolean }
  | { ok: false; problem: DobProblem };

/**
 * Everything the birthday screen needs from one date: whether the database would accept it, the
 * normalised string to send, and whether it makes the user an adult. `adult: false` is still `ok`:
 * the screen sends it anyway, because the database must record the blocked outcome.
 */
export function checkDateOfBirth(input: string | DateParts, now: Date = new Date()): DobCheck {
  let parts: DateParts | null;
  if (typeof input === 'string') {
    if (!DATE_TEXT.test(input.trim())) return { ok: false, problem: 'invalid_format' };
    parts = parseDateOfBirth(input);
  } else {
    parts = input;
  }
  if (!parts || !isRealDate(parts)) return { ok: false, problem: 'invalid_date' };
  if (key(parts) < key(EARLIEST)) return { ok: false, problem: 'too_old' };
  const today = utcToday(now);
  if (key(parts) > key(today)) return { ok: false, problem: 'in_future' };
  return { ok: true, dob: formatDateParts(parts), adult: isAdult(parts, today) };
}

/** What public.set_my_date_of_birth returns. */
export type AgeOutcome = 'adult' | 'blocked';

export function isAgeOutcome(value: unknown): value is AgeOutcome {
  return value === 'adult' || value === 'blocked';
}
