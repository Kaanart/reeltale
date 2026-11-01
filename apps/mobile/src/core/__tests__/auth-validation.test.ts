import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDateOfBirth } from '../age.ts';
import { ApiError } from '../api.ts';
import {
  CODE_LENGTH, cleanCode, dobText, isCompleteCode, isValidEmail, normalizeEmail, signInErrorText, SignInCancelled, SignInUnavailable,
} from '../../features/auth/validation.ts';

test('emails are trimmed and lower-cased, and only plausible ones pass', () => {
  assert.equal(normalizeEmail('  Kaan@Example.COM '), 'kaan@example.com');
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.org', ' Judge@Example.com ']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['', 'a', 'a@b', 'a@b.', '@b.co', 'a b@c.de', 'a@b@c.de', 'a@.co', `${'x'.repeat(250)}@b.co`]) {
    assert.equal(isValidEmail(bad), false, bad);
  }
});

test('codes are six digits; pasting with spaces or dashes works', () => {
  assert.equal(CODE_LENGTH, 6);
  assert.equal(cleanCode('123 456'), '123456');
  assert.equal(cleanCode('12-34-56-78'), '123456');
  assert.equal(cleanCode('abc'), '');
  assert.equal(isCompleteCode('123456'), true);
  assert.equal(isCompleteCode('12345'), false);
  assert.equal(isCompleteCode('1234567'), false);
  assert.equal(isCompleteCode('12345a'), false);
});

test('the birthday fields become YYYY-MM-DD, and age.ts says what is wrong', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.equal(dobText('7', '3', '1990'), '1990-03-07');
  assert.equal(dobText(' 07 ', '03', '1990'), '1990-03-07');
  assert.deepEqual(checkDateOfBirth(dobText('7', '3', '1990'), now), { ok: true, dob: '1990-03-07', adult: true });
  // Empty or partial fields: the "enter day, month and year" message.
  for (const [d, m, y] of [['', '3', '1990'], ['7', '', '1990'], ['7', '3', '90'], ['x', '3', '1990'], ['123', '3', '1990']]) {
    const r = checkDateOfBirth(dobText(d!, m!, y!), now);
    assert.deepEqual(r, { ok: false, problem: 'invalid_format' }, `${d}/${m}/${y}`);
  }
  assert.deepEqual(checkDateOfBirth(dobText('30', '2', '2000'), now), { ok: false, problem: 'invalid_date' });
  assert.deepEqual(checkDateOfBirth(dobText('1', '1', '1850'), now), { ok: false, problem: 'too_old' });
  assert.deepEqual(checkDateOfBirth(dobText('1', '1', '2030'), now), { ok: false, problem: 'in_future' });
  // A minor's date is valid input: it is sent, and the database records the block.
  assert.deepEqual(checkDateOfBirth(dobText('30', '10', '2008'), now), { ok: true, dob: '2008-10-30', adult: false });
  assert.deepEqual(checkDateOfBirth(dobText('29', '10', '2008'), now), { ok: true, dob: '2008-10-29', adult: true });
});

test('sign-in failures map to our own messages; a cancelled Apple sheet says nothing', () => {
  assert.equal(signInErrorText(new SignInCancelled()), null);
  assert.deepEqual(signInErrorText(new SignInUnavailable()), { key: 'errors:sign_in_unavailable', params: {} });
  assert.deepEqual(signInErrorText({ code: 'provider_disabled', status: 400, message: 'Unsupported provider' }), { key: 'errors:sign_in_unavailable', params: {} });
  // Supabase Auth's codes and our client-side ones go through errors.ts.
  assert.equal(signInErrorText({ code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' })?.key, 'errors:otp_expired');
  assert.equal(signInErrorText({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' })?.key, 'errors:invalid_credentials');
  assert.equal(signInErrorText(new ApiError(400, 'email_address_invalid'))?.key, 'errors:email_invalid');
  assert.equal(signInErrorText({ code: 'over_email_send_rate_limit', status: 429, message: 'x' })?.key, 'errors:rate_limited');
  assert.equal(signInErrorText(new ApiError(400, 'flow_state_not_found'))?.key, 'errors:sign_in_expired');
  // Server text never comes through.
  assert.equal(signInErrorText(new Error('Some <b>raw</b> server message'))?.key, 'errors:generic');
});
