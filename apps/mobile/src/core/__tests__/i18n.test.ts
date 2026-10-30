import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { checkDateOfBirth } from '../age.ts';
import { ApiError } from '../api.ts';
import { describeError, ERROR_CODES, ERROR_KEYS } from '../errors.ts';
import { describeJob, JOB_KEYS, JOB_STEPS } from '../jobs.ts';
import { bonusGroup } from '../wallet.ts';

// ---- Load the English strings ----------------------------------------------------------------------

const dir = new URL('../../i18n/en/', import.meta.url);
type Tree = { [key: string]: Tree | string };

const namespaces: Record<string, Tree> = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  namespaces[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Tree;
}

function flatten(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]): [string, string][] =>
    typeof v === 'string' ? [[prefix + k, v]] : flatten(v, `${prefix}${k}.`));
}

const leaves: { ns: string; path: string; text: string }[] =
  Object.entries(namespaces).flatMap(([ns, tree]) => flatten(tree).map(([path, text]) => ({ ns, path, text })));

/** Does `ns:path` resolve to a string? A plural key resolves through its `_other` form, as i18next does. */
function resolves(key: string): boolean {
  const [ns, path] = key.split(':');
  if (!ns || !path || !namespaces[ns]) return false;
  const found = new Set(flatten(namespaces[ns]).map(([p]) => p));
  return found.has(path) || found.has(`${path}_other`);
}

test('there is one namespace per area of the app, and nothing else', () => {
  assert.deepEqual(Object.keys(namespaces), [
    'age', 'ai', 'auth', 'common', 'create', 'editor', 'errors', 'home', 'profile', 'redeem', 'report', 'series',
    'settings', 'story', 'studio', 'unlock', 'vip', 'wallet', 'watch',
  ]);
  assert.ok(leaves.length > 700);
});

test('every string is plain text: not empty, no stray spaces, no markup, short', () => {
  for (const { ns, path, text } of leaves) {
    const id = `${ns}:${path}`;
    assert.equal(text, text.trim(), `${id} has leading or trailing space`);
    assert.ok(text.length > 0, `${id} is empty`);
    assert.ok(!/<[a-z/][^>]*>/i.test(text), `${id} contains markup`);
    assert.ok(!/\s{2,}/.test(text), `${id} has a double space`);
    assert.ok(text.length <= 260, `${id} is ${text.length} characters: keep strings short`);
  }
});

test('typography is consistent: curly apostrophes and quotes, never straight ones', () => {
  for (const { ns, path, text } of leaves) {
    assert.ok(!/['"]/.test(text), `${ns}:${path} has a straight quote: ${text}`);
  }
});

// ---- Placeholders and plurals -----------------------------------------------------------------------

const TOKEN = /\{\{[^}]*\}\}/g;
const VALID_TOKEN = /^\{\{\s*[A-Za-z_]\w*(\s*,\s*(number))?\s*\}\}$/;

const names = (text: string) => [...text.matchAll(TOKEN)].map((m) => /[A-Za-z_]\w*/.exec(m[0])?.[0] ?? '');

test('placeholders are i18next {{name}} (or {{count, number}}), and braces are balanced', () => {
  for (const { ns, path, text } of leaves) {
    for (const token of text.match(TOKEN) ?? []) assert.match(token, VALID_TOKEN, `${ns}:${path}`);
    const without = text.replace(TOKEN, '');
    assert.ok(!/[{}]/.test(without), `${ns}:${path} has a stray brace: ${text}`);
  }
});

test('{{count}} is only used in plural strings (_one / _other), and plurals come in pairs', () => {
  const byId = new Map(leaves.map((l) => [`${l.ns}:${l.path}`, l.text]));
  for (const { ns, path, text } of leaves) {
    const id = `${ns}:${path}`;
    const plural = /_(one|other)$/.test(path);
    if (names(text).includes('count')) assert.ok(plural, `${id} uses {{count}} but is not a plural form`);
    if (path.endsWith('_one')) assert.ok(byId.has(`${id.replace(/_one$/, '')}_other`), `${id} has no _other`);
    if (path.endsWith('_other')) assert.ok(byId.has(`${id.replace(/_other$/, '')}_one`), `${id} has no _one`);
    if (path.endsWith('_other')) assert.ok(names(text).includes('count'), `${id} must show the count`);
  }
  // The two forms of a plural take the same other placeholders.
  for (const { ns, path, text } of leaves.filter((l) => l.path.endsWith('_other'))) {
    const one = byId.get(`${ns}:${path.replace(/_other$/, '_one')}`) ?? '';
    const rest = (t: string) => [...new Set(names(t).filter((n) => n !== 'count'))].sort();
    assert.deepEqual(rest(one), rest(text), `${ns}:${path} and its _one form use different placeholders`);
  }
});

// ---- Everything the core modules refer to exists -----------------------------------------------------

test('every key errors.ts can return exists in the strings (plural variants too)', () => {
  assert.ok(ERROR_KEYS.length > 40);
  const missing = ERROR_KEYS.filter((k) => !resolves(k));
  assert.deepEqual(missing, []);
});

test('the plural messages errors.ts picks for a number have both forms', () => {
  for (const key of ERROR_KEYS.filter((k) => k.endsWith('_count'))) {
    const [ns, path] = key.split(':') as [string, string];
    const found = new Set(flatten(namespaces[ns]!).map(([p]) => p));
    assert.ok(found.has(`${path}_one`) && found.has(`${path}_other`), key);
  }
});

test('every error code gives a message that exists, with its number when it has one', () => {
  for (const code of ERROR_CODES) {
    for (const detail of [undefined, 0, 1, 7]) {
      const info = describeError(new ApiError(400, code, detail));
      assert.ok(resolves(info.key), `${code} -> ${info.key}`);
    }
  }
});

test('every key jobs.ts can return exists', () => {
  assert.deepEqual(JOB_KEYS.filter((k) => !resolves(k)), []);
  for (const step of JOB_STEPS) assert.ok(resolves(`ai:progress.${step}`), step);
});

test('the AI job states of the blueprint all have text', () => {
  for (const state of ['planning', 'casting', 'writing', 'drawing', 'checking', 'framing', 'ready', 'failed', 'blocked']) {
    assert.ok(resolves(`ai:progress.${state}`), state);
  }
  assert.equal(describeJob({ status: 'failed', progress: null, error_code: 'blocked:x' }).key, 'ai:progress.blocked');
});

test('every date-of-birth problem has a message', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const problems = new Set<string>();
  for (const input of ['x', '1990-02-30', '1850-01-01', '2999-01-01']) {
    const r = checkDateOfBirth(input, now);
    assert.equal(r.ok, false);
    if (!r.ok) problems.add(r.problem);
  }
  assert.deepEqual([...problems].sort(), ['in_future', 'invalid_date', 'invalid_format', 'too_old']);
  for (const p of problems) assert.ok(resolves(`age:errors.${p}`), p);
});

test('every kind of bonus coin has a label', () => {
  const groups = new Set(['iap', 'web', 'sub_grant', 'trial', 'promo', 'code', 'sandbox', 'refund_return', 'admin'].map(bonusGroup));
  for (const g of groups) assert.ok(resolves(`wallet:source.${g}`), g);
  assert.deepEqual([...groups].sort(), ['bonus', 'returned', 'test', 'trial', 'vip']);
});

test('the screens the task names are all there', () => {
  const required = [
    'ai:label', 'ai:badgeA11y',
    'age:gate.title', 'age:gate.body', 'age:gate.hint', 'age:blocked.title', 'age:blocked.body', 'age:adultsOnly',
    'auth:welcome.tagline', 'auth:welcome.adultsOnly', 'auth:email.hint', 'auth:code.hint', 'auth:terms.body', 'auth:password.title',
    'unlock:title', 'unlock:unlock', 'unlock:useFreePass', 'unlock:freePassesLeft', 'unlock:freePassesNone', 'unlock:getCoins',
    'unlock:joinVip', 'unlock:permanent', 'unlock:priceChanged', 'unlock:freePass.title', 'unlock:freePass.body',
    'wallet:title', 'wallet:balance', 'wallet:paid.hint', 'wallet:bonus.hint', 'wallet:lot.expiresOn', 'wallet:store.restore', 'wallet:policy',
    'vip:title', 'vip:perks.coins', 'vip:perks.discount', 'vip:perks.freePass', 'vip:autoRenew', 'vip:restore', 'vip:terms', 'vip:privacy',
    'story:new.title', 'story:player.map', 'story:choices.title', 'story:choices.sayYourChoice', 'story:choices.writeYourOwn',
    'story:choices.regenerateCost', 'story:map.title', 'story:howMade.title', 'story:publish.title', 'story:publish.notice',
    'create:title', 'studio:title', 'studio:apply.title', 'studio:earnings.title', 'studio:stopMotion.title',
    'home:home.demo.title', 'home:discover.title', 'home:library.title', 'home:shorts.title',
    'series:play', 'watch:next.label', 'settings:title', 'settings:delete.title', 'settings:delete.confirmWord',
    'report:title', 'editor:title', 'profile:me.title', 'profile:user.title', 'redeem:title', 'common:link.opening',
  ];
  assert.deepEqual(required.filter((k) => !resolves(k)), []);
});

test('the AI label is plain', () => {
  assert.equal(namespaces.ai?.label, 'Made with AI');
});

test('typing DELETE is the confirmation, and the word is a string the screen compares against', () => {
  const settings = namespaces.settings as { delete: { confirmWord: string } };
  assert.equal(settings.delete.confirmWord, 'DELETE');
});

// ---- Rules for what the native apps may say ----------------------------------------------------------

// App Store 3.1.1: no access codes, promo codes or pointers to buying elsewhere in the native apps. Strings are shared by every
// platform, so only the `redeem` namespace (the web-only screen) may use this wording.
const NOT_IN_NATIVE = /access code|promo|redeem|voucher|coupon|gift code|invite code|referral code|reeltale\.net|website|\bweb\b|\bbrowser\b|elsewhere|cheaper|discount code|license key/i;

test('only the web-only redeem namespace talks about codes and the website', () => {
  const hits = leaves.filter((l) => l.ns !== 'redeem' && NOT_IN_NATIVE.test(l.text)).map((l) => `${l.ns}:${l.path}: ${l.text}`);
  assert.deepEqual(hits, []);
  // The check can fail: the web namespace does use the wording.
  assert.ok(leaves.some((l) => l.ns === 'redeem' && NOT_IN_NATIVE.test(l.text)));
});

test('error messages for codes are in the web-only namespace, so native screens cannot show them', () => {
  const inNative = leaves.filter((l) => l.ns === 'errors' && /\bcode\b/i.test(l.text) && !/^(otp_expired)$/.test(l.path));
  assert.deepEqual(inNative.map((l) => l.path), []);
});

test('AI stories are never described as original, authentic or human-made', () => {
  const hits = leaves.filter((l) => /\boriginals?\b|authentic|human[- ]made|handmade|real footage/i.test(l.text));
  assert.deepEqual(hits.map((l) => `${l.ns}:${l.path}`), []);
});

test('AI content is labelled as made with AI, in plain words', () => {
  const ai = namespaces.ai as { label: string; labelLong: string; disclosure: { body: string } };
  assert.match(ai.labelLong, /made with AI/i);
  assert.match(ai.disclosure.body, /AI/);
  const series = namespaces.series as { aiNotice: string };
  assert.match(series.aiNotice, /made with AI/i);
  const publish = (namespaces.story as { publish: { notice: string } }).publish.notice;
  assert.match(publish, /free to watch/i);
  assert.match(publish, /made with AI/i);
});

test('nothing promotes the $1.99 pack as a percentage off, and coins are never cash', () => {
  const hits = leaves.filter((l) => /\d+\s?% off/i.test(l.text) && l.ns === 'wallet');
  assert.deepEqual(hits, []);
  assert.match((namespaces.wallet as { policy: string }).policy, /can’t be cashed out or transferred/);
});

test('messages say what the server actually means by the code', () => {
  const errors = namespaces.errors as Record<string, string>;
  // Supabase Auth answers otp_expired for a mistyped code as well ("Token has expired or is invalid").
  assert.match(errors.otp_expired ?? '', /wrong/);
  // The database's rate_limited is a daily cap (series per day, AI stories and scenes per day): waiting a moment won't help.
  assert.doesNotMatch(errors.rate_limited ?? '', /moment/);
  // Applying to earn records status 'applied'; earning starts only when svc.set_creator_status makes it 'active'.
  const studio = namespaces.studio as { apply: { submitted: string } };
  assert.doesNotMatch(studio.apply.submitted, /can now earn/);
});

test('the 18+ gate says adults only and that the date cannot be changed', () => {
  const age = namespaces.age as { gate: { body: string; hint: string }; blocked: Tree };
  assert.match(age.gate.body, /18 or older/);
  assert.match(age.gate.hint, /can’t change this later/);
  assert.ok(!('retry' in age.blocked) && !('tryAgain' in age.blocked), 'the blocked screen has no retry');
});
