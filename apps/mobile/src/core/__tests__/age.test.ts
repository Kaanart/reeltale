import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adultCutoff, checkDateOfBirth, daysInMonth, formatDateParts, isAdult, isAgeOutcome, parseDateOfBirth,
  partsFromLocalDate, utcToday,
} from '../age.ts';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

test('parseDateOfBirth accepts real dates only, in YYYY-MM-DD', () => {
  assert.deepEqual(parseDateOfBirth('1990-07-04'), { year: 1990, month: 7, day: 4 });
  assert.deepEqual(parseDateOfBirth('  2000-02-29 '), { year: 2000, month: 2, day: 29 });
  for (const bad of ['', '1990-7-4', '90-07-04', '1990/07/04', '04-07-1990', '1990-07-04T00:00:00Z', '1990-13-01', '1990-00-10',
    '1990-04-31', '1990-02-30', '2001-02-29', '1900-02-29', '0000-01-01', 'abcd-ef-gh', '1990-07-04; drop table']) {
    assert.equal(parseDateOfBirth(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
  // Leap year rules: divisible by 4, except centuries that aren't divisible by 400.
  assert.ok(parseDateOfBirth('2000-02-29'));
  assert.equal(parseDateOfBirth('2100-02-29'), null);
  assert.ok(parseDateOfBirth('2024-02-29'));
});

test('daysInMonth knows leap years', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2025, 4), 30);
  assert.equal(daysInMonth(2025, 12), 31);
});

test('formatDateParts pads to the Postgres date format', () => {
  assert.equal(formatDateParts({ year: 1990, month: 7, day: 4 }), '1990-07-04');
  assert.equal(formatDateParts({ year: 987, month: 12, day: 31 }), '0987-12-31');
});

test('utcToday uses the UTC calendar date, not the local one', () => {
  assert.deepEqual(utcToday(new Date('2026-10-28T23:30:00Z')), { year: 2026, month: 10, day: 28 });
  assert.deepEqual(utcToday(new Date('2026-10-29T00:30:00Z')), { year: 2026, month: 10, day: 29 });
});

test('partsFromLocalDate reads the picker date in local fields', () => {
  assert.deepEqual(partsFromLocalDate(new Date(1999, 11, 31, 0, 0, 0)), { year: 1999, month: 12, day: 31 });
  assert.deepEqual(partsFromLocalDate(new Date(2000, 0, 1, 23, 59, 59)), { year: 2000, month: 1, day: 1 });
});

test('adultCutoff is today minus 18 years, day clamped like Postgres (values verified against Postgres)', () => {
  assert.deepEqual(adultCutoff({ year: 2026, month: 10, day: 28 }), { year: 2008, month: 10, day: 28 });
  // A leap day today has no equal 18 years ago in a common year: Postgres clamps to Feb 28.
  assert.deepEqual(adultCutoff({ year: 2028, month: 2, day: 29 }), { year: 2010, month: 2, day: 28 });
  assert.deepEqual(adultCutoff({ year: 2026, month: 2, day: 28 }), { year: 2008, month: 2, day: 28 });
  // 18 years before 2042 is 2024, a leap year: Feb 28 and Mar 1 map straight across.
  assert.deepEqual(adultCutoff({ year: 2042, month: 2, day: 28 }), { year: 2024, month: 2, day: 28 });
  assert.deepEqual(adultCutoff({ year: 2042, month: 3, day: 1 }), { year: 2024, month: 3, day: 1 });
  assert.deepEqual(adultCutoff({ year: 2026, month: 1, day: 31 }), { year: 2008, month: 1, day: 31 });
});

test('isAdult: the 18th birthday is the first adult day, one day earlier is not', () => {
  const today = at('2026-10-28');
  assert.equal(isAdult('2008-10-28', today), true);
  assert.equal(isAdult('2008-10-29', today), false);
  assert.equal(isAdult('2008-10-27', today), true);
  assert.equal(isAdult('1990-01-01', today), true);
  assert.equal(isAdult('2010-05-05', today), false);
});

test('isAdult: a Feb 29 birthday turns 18 on Mar 1 in a common year (same as Postgres)', () => {
  assert.equal(isAdult('2008-02-29', at('2026-02-28')), false);
  assert.equal(isAdult('2008-02-29', at('2026-03-01')), true);
  // In a leap year the 29th itself works: 2008-02-29 vs the cutoff on 2028-02-29 (2010-02-28) is long past.
  assert.equal(isAdult('2012-02-29', at('2030-02-28')), false);
  assert.equal(isAdult('2012-02-29', at('2030-03-01')), true);
  // Born Feb 28 turns 18 on Feb 28 even when the cutoff year is a leap year.
  assert.equal(isAdult('2010-02-28', at('2028-02-28')), true);
  assert.equal(isAdult('2010-02-28', at('2028-02-29')), true);
  assert.equal(isAdult('2010-03-01', at('2028-02-29')), false);
});

test('isAdult uses the UTC date of the clock', () => {
  // 23:30 UTC on Oct 28 is still Oct 28 in UTC, even though it is already Oct 29 in Amsterdam.
  assert.equal(isAdult('2008-10-29', new Date('2026-10-28T23:30:00Z')), false);
  assert.equal(isAdult('2008-10-29', new Date('2026-10-29T00:00:01Z')), true);
});

test('isAdult refuses unreadable dates instead of guessing', () => {
  assert.equal(isAdult('not a date', at('2026-10-28')), false);
  assert.equal(isAdult({ year: 2000, month: 2, day: 30 }, at('2026-10-28')), false);
});

test('checkDateOfBirth mirrors the database range rules', () => {
  const now = at('2026-10-28');
  assert.deepEqual(checkDateOfBirth('1990-07-04', now), { ok: true, dob: '1990-07-04', adult: true });
  assert.deepEqual(checkDateOfBirth(' 1990-07-04 ', now), { ok: true, dob: '1990-07-04', adult: true });
  // Under 18 is accepted (the database records the blocked outcome), with adult: false.
  assert.deepEqual(checkDateOfBirth('2012-01-01', now), { ok: true, dob: '2012-01-01', adult: false });
  // current_date itself is allowed, tomorrow is not.
  assert.deepEqual(checkDateOfBirth('2026-10-28', now), { ok: true, dob: '2026-10-28', adult: false });
  assert.deepEqual(checkDateOfBirth('2026-10-29', now), { ok: false, problem: 'in_future' });
  assert.deepEqual(checkDateOfBirth('2999-01-01', now), { ok: false, problem: 'in_future' });
  // 1900-01-01 is the first accepted day.
  assert.deepEqual(checkDateOfBirth('1900-01-01', now), { ok: true, dob: '1900-01-01', adult: true });
  assert.deepEqual(checkDateOfBirth('1899-12-31', now), { ok: false, problem: 'too_old' });
  assert.deepEqual(checkDateOfBirth('1850-01-01', now), { ok: false, problem: 'too_old' });
});

test('checkDateOfBirth tells a wrong format from a date that does not exist', () => {
  const now = at('2026-10-28');
  assert.deepEqual(checkDateOfBirth('4 July 1990', now), { ok: false, problem: 'invalid_format' });
  assert.deepEqual(checkDateOfBirth('', now), { ok: false, problem: 'invalid_format' });
  assert.deepEqual(checkDateOfBirth('1990-02-30', now), { ok: false, problem: 'invalid_date' });
  assert.deepEqual(checkDateOfBirth('1990-13-01', now), { ok: false, problem: 'invalid_date' });
  assert.deepEqual(checkDateOfBirth('2001-02-29', now), { ok: false, problem: 'invalid_date' });
});

test('checkDateOfBirth takes date parts from a picker and validates them the same way', () => {
  const now = at('2026-10-28');
  assert.deepEqual(checkDateOfBirth({ year: 2000, month: 2, day: 29 }, now), { ok: true, dob: '2000-02-29', adult: true });
  assert.deepEqual(checkDateOfBirth({ year: 2001, month: 2, day: 29 }, now), { ok: false, problem: 'invalid_date' });
  assert.deepEqual(checkDateOfBirth({ year: 1990, month: 1.5, day: 1 }, now), { ok: false, problem: 'invalid_date' });
  assert.deepEqual(checkDateOfBirth({ year: 3000, month: 1, day: 1 }, now), { ok: false, problem: 'in_future' });
});

test('checkDateOfBirth: the adult flag follows the cutoff day by day', () => {
  const now = at('2026-10-28');
  const born = (dob: string) => {
    const r = checkDateOfBirth(dob, now);
    assert.ok(r.ok);
    return r.adult;
  };
  assert.equal(born('2008-10-28'), true);
  assert.equal(born('2008-10-29'), false);
});

test('isAgeOutcome accepts exactly what set_my_date_of_birth returns', () => {
  assert.equal(isAgeOutcome('adult'), true);
  assert.equal(isAgeOutcome('blocked'), true);
  assert.equal(isAgeOutcome('Adult'), false);
  assert.equal(isAgeOutcome(null), false);
  assert.equal(isAgeOutcome(undefined), false);
});
