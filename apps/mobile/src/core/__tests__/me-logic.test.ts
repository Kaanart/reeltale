import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RedeemResponseSchema, WalletSchema } from '@reeltale/shared';
import { ApiError } from '../api.ts';
import { summarizeWallet } from '../wallet.ts';
import { DEMO_SCENE_ID, demoEpisodes, demoSeries, demoWallet } from '../../demo/fixtures.ts';
import {
  demoBlocksCell, demoConsentsCell, demoContentOwner, demoReportsCell, demoSubscriptionsCell, demoWalletCell,
} from '../../features/me/demo.ts';
import { BLOCK_COLUMNS, isBlockedIn, parseBlocks } from '../../features/me/logic/blocks.ts';
import {
  AI_CONSENT_PURPOSES, AI_CONSENT_VERSION, consentArgs, consentOn, parseConsents, type ConsentRow,
} from '../../features/me/logic/consent.ts';
import { formatDay, isSameLocalDay } from '../../features/me/logic/dates.ts';
import { isDeleteConfirmed } from '../../features/me/logic/deletion.ts';
import { blockErrorText, errorText } from '../../features/me/logic/errors.ts';
import { LEGAL_BASE, LEGAL_LABEL_KEYS, LEGAL_PAGES, legalUrl } from '../../features/me/logic/legal.ts';
import { displayNameOf, handleText, initialOf } from '../../features/me/logic/profileView.ts';
import {
  blockableUser, blockOfferKey, checkReport, cleanDetails, DETAILS_MAX, parseReportParams, reasonsFor, REPORT_REASONS,
  REPORT_TARGET_TYPES, reportArgs, reportHref, uuidOrNull,
} from '../../features/me/logic/report.ts';
import {
  activeSubscription, deletionNotice, manageSubscriptionUrl, parseSubscriptions, renewingSubscription, storeNameKey,
  type SubscriptionRow,
} from '../../features/me/logic/subscription.ts';
import { parseVipConfig, VIP_DEFAULTS } from '../../features/me/logic/vip.ts';
import { expiryText, lotLabelKey, lotLines } from '../../features/me/logic/walletView.ts';
import {
  CODE_MAX, CODE_MIN, isCodeFormat, normalizeCode, parseSiteKey, redeemMessages,
} from '../../features/me/redeem/redeemLogic.ts';

const read = (path: string) => readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const UUID_A = '5e0a1b2c-1111-4222-8333-444455556666';
const UUID_B = 'c0ffee00-2222-4333-8444-555566667777';
const NOW = new Date('2026-10-29T12:00:00Z');
const DAY = 86_400_000;

// ---- Kept in step with the database --------------------------------------------------------------------

test('the report reasons and target types are the database’s own (check_report in the trust migration)', () => {
  const sql = read('supabase/migrations/20261028090100_trust.sql');
  const fn = /create function app_private\.check_report[\s\S]*?\$\$;/.exec(sql)?.[0] ?? '';
  const sqlTypes = [...(/p_target_type not in \(([^)]*)\)/.exec(fn)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const sqlReasons = [...(/p_reason not in \(([^)]*)\)/.exec(fn)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(sqlTypes.length === 4 && sqlReasons.length === 11, 'the SQL lists were not found');
  assert.deepEqual([...REPORT_TARGET_TYPES].sort(), [...sqlTypes].sort());
  assert.deepEqual([...REPORT_REASONS].sort(), [...sqlReasons].sort());
  assert.equal(DETAILS_MAX, Number(/char_length\(p_details\) > (\d+)/.exec(fn)?.[1]));
});

test('the consent purposes are the database’s, and the ones the database checks include the provider it checks', () => {
  const sql = read('supabase/migrations/20261027090100_accounts.sql');
  const sqlPurposes = [...(/purpose in \(([^)]*)\)/.exec(sql)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(AI_CONSENT_PURPOSES.map((p) => p.purpose).sort(), [...sqlPurposes].sort());
  // has_ai_consent(user, 'story' | 'upload_processing', 'meta') is what the story start and the ingest check.
  for (const purpose of ['story', 'upload_processing']) {
    assert.ok(AI_CONSENT_PURPOSES.find((p) => p.purpose === purpose)?.providers.includes('meta'), purpose);
  }
  assert.match(AI_CONSENT_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test('the VIP defaults match the pricing config and the Worker’s monthly grant', () => {
  const ledger = read('supabase/migrations/20261027090300_ledger.sql');
  assert.equal(VIP_DEFAULTS.discountPct, Number(/\('plus_discount_pct', '(\d+)'\)/.exec(ledger)?.[1]));
  assert.equal(VIP_DEFAULTS.extraFreePasses, Number(/\('free_passes_plus_bonus', '(\d+)'\)/.exec(ledger)?.[1]));
  const worker = read('apps/server/src/webhooks/revenuecat.ts');
  assert.equal(VIP_DEFAULTS.coins, Number(/'reeltale\.plus\.monthly': \{ coins: (\d+) \}/.exec(worker)?.[1]));
});

test('the redeem checks are the Worker’s (6 to 40 letters, digits and dashes)', () => {
  const worker = read('apps/server/src/routes/user.ts');
  assert.match(worker, /code: z\.string\(\)\.trim\(\)\.min\(6\)\.max\(40\)\.regex\(\/\^\[A-Za-z0-9-\]\+\$\/\)/);
  assert.equal(CODE_MIN, 6);
  assert.equal(CODE_MAX, 40);
  // The widget's action is what the Worker verifies.
  assert.match(worker, /expectedAction: 'redeem'/);
  assert.match(readFileSync(new URL('../../features/me/redeem/Turnstile.tsx', import.meta.url), 'utf8'), /action: 'redeem'/);
});

// ---- Dates and the wallet --------------------------------------------------------------------------------

test('formatDay writes a short day, and nothing for a date it cannot read', () => {
  assert.equal(formatDay(new Date(2026, 10, 12, 12), 'en'), 'Nov 12, 2026');
  assert.equal(formatDay('not a date', 'en'), '');
  assert.ok(isSameLocalDay(new Date(2026, 9, 29, 1), new Date(2026, 9, 29, 23)));
  assert.ok(!isSameLocalDay(new Date(2026, 9, 29, 23), new Date(2026, 9, 30, 0)));
});

test('a bonus lot says today, in days (within a week), or on its date', () => {
  const wallet = {
    balance: 0, paid: 0, bonus: 0, refund_debt: 0, free_passes_left: 0,
    expiring: [
      { coins: 5, expires_at: new Date(NOW.getTime() + 3600_000).toISOString(), source: 'trial' },
      { coins: 60, expires_at: new Date(NOW.getTime() + 5 * DAY).toISOString(), source: 'sub_grant' },
      { coins: 30, expires_at: new Date(NOW.getTime() + 20 * DAY).toISOString(), source: 'code' },
    ],
  };
  const summary = summarizeWallet(wallet, NOW);
  const lines = lotLines(summary.expiring, NOW, 'en');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.group), ['trial', 'vip', 'bonus']);
  assert.equal(lines[1]?.expiry.key, 'wallet:lot.expiresInDays');
  assert.equal(lines[1]?.expiry.params.count, 5);
  assert.equal(lines[2]?.expiry.key, 'wallet:lot.expiresOn');
  assert.match(String(lines[2]?.expiry.params.date), /\d{4}/);
  assert.equal(new Set(lines.map((l) => l.id)).size, 3, 'row ids are unique');
  assert.equal(lotLabelKey('vip'), 'wallet:source.vip');
  // Same calendar day in the viewer's time zone (built from local parts, so the zone doesn't matter).
  const morning = new Date(2026, 9, 29, 9);
  const noon = new Date(2026, 9, 29, 12);
  const todayLot = summarizeWallet({ ...wallet, expiring: [{ coins: 5, expires_at: noon.toISOString(), source: 'trial' }] }, morning).expiring[0]!;
  assert.equal(expiryText(todayLot, morning, 'en').key, 'wallet:lot.expiresToday');
});

test('the demo fixtures of the Me track have the shapes the screens and the database use', () => {
  assert.ok(WalletSchema.safeParse(demoWalletCell.get()).success);
  assert.deepEqual(demoWalletCell.get(), { ...demoWallet(), expiring: demoWalletCell.get().expiring });
  assert.deepEqual(demoConsentsCell.get(), []);
  assert.deepEqual(demoSubscriptionsCell.get(), []);
  assert.deepEqual(demoBlocksCell.get(), []);
  assert.deepEqual(demoReportsCell.get(), []);
  // The demo wallet has a lot that expires soon, so the reminder shows.
  assert.ok(summarizeWallet(demoWalletCell.get()).expiringSoonCoins > 0);
});

// ---- Consents ---------------------------------------------------------------------------------------------

test('consent rows are read defensively, and a purpose is on until it is withdrawn', () => {
  assert.equal(parseConsents(null), null);
  assert.equal(parseConsents({}), null);
  const rows = parseConsents([
    { purpose: 'story', providers: ['meta', 'google'], version: '2026-10-22', accepted_at: '2026-10-29T10:00:00Z', withdrawn_at: null },
    { purpose: 'voice', providers: ['meta'], version: '2026-10-22', accepted_at: '2026-10-29T10:00:00Z', withdrawn_at: '2026-10-29T11:00:00Z' },
    { purpose: 'tracking', providers: ['x'], version: 'v', accepted_at: '', withdrawn_at: null },
    'junk',
    { purpose: 'upload_processing', providers: 'meta', version: 'v' },
  ]);
  assert.equal(rows?.length, 2);
  assert.equal(consentOn(rows ?? [], 'story'), true);
  assert.equal(consentOn(rows ?? [], 'voice'), false);
  assert.equal(consentOn(rows ?? [], 'upload_processing'), false);
  assert.equal(consentOn(undefined, 'story'), false);
});

test('set_ai_consent gets the providers and version when giving, and keeps what was recorded when withdrawing', () => {
  const give = consentArgs('story', true);
  assert.deepEqual(give, { p_purpose: 'story', p_providers: ['meta', 'google'], p_version: AI_CONSENT_VERSION, p_granted: true });
  const old: ConsentRow = { purpose: 'story', providers: ['meta'], version: '2026-09-01', accepted_at: '', withdrawn_at: null };
  assert.deepEqual(consentArgs('story', false, old), { p_purpose: 'story', p_providers: ['meta'], p_version: '2026-09-01', p_granted: false });
  // Withdrawing with no row yet still sends well-formed arguments.
  assert.deepEqual(consentArgs('voice', false), { p_purpose: 'voice', p_providers: ['meta'], p_version: AI_CONSENT_VERSION, p_granted: false });
  // The list handed over is a copy: changing it can't change the table.
  give.p_providers.push('x');
  assert.deepEqual(consentArgs('story', true).p_providers, ['meta', 'google']);
});

// ---- Reports and blocks -----------------------------------------------------------------------------------

test('the report route takes a known type and a UUID, and nothing else', () => {
  assert.deepEqual(parseReportParams({ type: 'series', id: UUID_A.toUpperCase() }), { type: 'series', id: UUID_A, creatorId: null });
  assert.deepEqual(parseReportParams({ type: ['ai_scene', 'x'], id: [UUID_A], creator: UUID_B }), { type: 'ai_scene', id: UUID_A, creatorId: UUID_B });
  assert.equal(parseReportParams({ type: 'series', id: UUID_A, creator: 'nope' })?.creatorId, null);
  for (const bad of [{}, { type: 'series' }, { id: UUID_A }, { type: 'comment', id: UUID_A }, { type: 'series', id: 'abc' }, { type: 'series', id: `${UUID_A}'; drop` }]) {
    assert.equal(parseReportParams(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(reportHref('episode', UUID_A, UUID_B), { pathname: '/report', params: { type: 'episode', id: UUID_A, creator: UUID_B } });
  assert.deepEqual(reportHref('series', UUID_A), { pathname: '/report', params: { type: 'series', id: UUID_A } });
});

test('every reason can be picked, and a profile is not "AI that isn’t labelled"', () => {
  for (const type of REPORT_TARGET_TYPES) {
    const reasons = reasonsFor(type);
    assert.ok(reasons.includes('minor_safety') && reasons.includes('other'), type);
    assert.ok(reasons.every((r) => (REPORT_REASONS as readonly string[]).includes(r)));
  }
  assert.ok(!reasonsFor('profile').includes('ai_not_labelled'));
  assert.ok(reasonsFor('ai_scene').includes('ai_not_labelled'));
  assert.equal(REPORT_REASONS[0], 'minor_safety');
  assert.equal(REPORT_REASONS.at(-1), 'other');
});

test('a report needs a reason and the good-faith tick, and its details are trimmed and capped', () => {
  assert.equal(checkReport({ reason: null, goodFaith: true }), 'need_reason');
  assert.equal(checkReport({ reason: 'spam_scam', goodFaith: false }), 'need_good_faith');
  assert.equal(checkReport({ reason: 'spam_scam', goodFaith: true }), null);
  assert.equal(cleanDetails('   '), null);
  assert.equal(cleanDetails('  hello  '), 'hello');
  assert.equal(cleanDetails('x'.repeat(DETAILS_MAX + 50))?.length, DETAILS_MAX);
  const target = parseReportParams({ type: 'profile', id: UUID_A });
  assert.ok(target);
  assert.deepEqual(reportArgs(target, 'impersonation', ' pretending '), {
    p_target_type: 'profile', p_target_id: UUID_A, p_reason: 'impersonation', p_details: 'pretending',
  });
});

test('only another person can be blocked: the profile itself, or the creator the database names, never yourself', () => {
  const profile = { type: 'profile', id: UUID_A, creatorId: null } as const;
  const series = { type: 'series', id: UUID_A, creatorId: null } as const;
  assert.equal(blockableUser(profile, UUID_B), UUID_A);
  assert.equal(blockableUser(profile, UUID_A), null);
  assert.equal(blockableUser(series, UUID_A, UUID_B), UUID_B);
  assert.equal(blockableUser(series, UUID_B, UUID_B), null);
  assert.equal(blockableUser(series, UUID_B.toUpperCase(), UUID_B), null);
  assert.equal(blockableUser(series, null, UUID_B.toUpperCase()), UUID_B);
  assert.equal(blockableUser(series, UUID_A, null), null);
  assert.equal(blockableUser(series, UUID_A, 'not-a-uuid'), null);
});

// Found in review: the block offer used the link's `creator` param, so a crafted link
// (/report?type=series&id=<real series>&creator=<anyone>) got the reporter to block someone unrelated.
test('the link’s creator param never decides whom to block; the content’s own row does', () => {
  const linked = parseReportParams({ type: 'series', id: UUID_A, creator: UUID_B });
  assert.ok(linked);
  assert.equal(linked.creatorId, UUID_B);
  assert.equal(blockableUser(linked, null), null);
  assert.equal(blockableUser(linked, null, null), null);
  const owner = 'c0ffee00-9999-4333-8444-555566667777';
  assert.equal(blockableUser(linked, null, owner), owner);
  // The screen asks for the owner and passes it in; nothing else reaches blockableUser.
  const screen = read('apps/mobile/src/features/me/screens/ReportScreen.tsx');
  assert.match(screen, /blockableUser\(target, selfId, owner\.data \?\? null\)/);
  assert.doesNotMatch(screen, /creatorId/);
  // uuidOrNull reads database answers defensively.
  assert.equal(uuidOrNull(UUID_B.toUpperCase()), UUID_B);
  for (const bad of [null, undefined, 7, '', 'x', `${UUID_B} `]) assert.equal(uuidOrNull(bad), null, String(bad));
});

test('in the demo, the owner of a series or episode is its series’ creator, and AI scenes and profiles have none', () => {
  const series = demoSeries[0];
  assert.ok(series?.creator_id);
  assert.equal(demoContentOwner('series', series.id), series.creator_id);
  const episode = demoEpisodes.find((e) => e.series_id === series.id);
  assert.ok(episode);
  assert.equal(demoContentOwner('episode', episode.id), series.creator_id);
  assert.equal(demoContentOwner('series', UUID_A), null);
  assert.equal(demoContentOwner('episode', UUID_A), null);
  assert.equal(demoContentOwner('ai_scene', DEMO_SCENE_ID), null);
  assert.equal(demoContentOwner('profile', series.creator_id), null);
  assert.equal(demoContentOwner(null, null), null);
});

// Found in review: a reported profile was offered "Block this creator too", though most people aren't creators.
test('the block offer calls a reported profile a person, and the maker of reported content its creator', () => {
  assert.equal(blockOfferKey('profile'), 'report:alsoBlockProfile');
  for (const type of ['series', 'episode', 'ai_scene'] as const) assert.equal(blockOfferKey(type), 'report:alsoBlock');
});

test('a block that finds nobody says so; the generic table would call it a sign-in problem', () => {
  assert.deepEqual(blockErrorText({ message: 'user_not_found', code: 'P0002', details: null }), { key: 'profile:user.notFound', params: {} });
  assert.equal(blockErrorText({ message: 'cannot_block_self', code: '22023' }).key, 'errors:cannot_block_self');
  assert.equal(errorText(new ApiError(0, 'network_error')).key, 'errors:network');
  assert.equal(errorText({ message: 'target_not_found', code: 'P0002' }).key, 'errors:target_not_found');
  assert.equal(errorText({ message: 'rate_limited', code: '54000' }).key, 'errors:rate_limited');
});

test('the blocked list reads public.blocks defensively, newest first', () => {
  assert.equal(parseBlocks(null), null);
  assert.equal(parseBlocks({ blocked_id: UUID_A }), null);
  const rows = parseBlocks([
    { blocked_id: UUID_A, created_at: '2026-10-01T10:00:00Z' },
    { blocked_id: UUID_B.toUpperCase(), created_at: '2026-10-20T10:00:00Z' },
    { blocked_id: 'not-a-uuid', created_at: '2026-10-25T10:00:00Z' },
    { blocked_id: '5e0a1b2c-1111-4222-8333-0000000000aa' },
    { created_at: '2026-10-25T10:00:00Z' },
    'junk',
    null,
  ]);
  // The undated row sorts last, ids are lower-cased, and the two odd ones are gone.
  assert.deepEqual(rows?.map((r) => r.blocked_id), [UUID_B, UUID_A, '5e0a1b2c-1111-4222-8333-0000000000aa']);
  assert.equal(rows?.[2]?.created_at, null);
  assert.equal(isBlockedIn(rows ?? [], UUID_B.toUpperCase()), true);
  assert.equal(isBlockedIn(rows ?? [], 'c0ffee00-9999-4333-8444-555566667777'), false);
  assert.equal(isBlockedIn([], UUID_A), false);
  // Only granted columns of public.blocks are read.
  assert.deepEqual(BLOCK_COLUMNS.split(', '), ['blocked_id', 'created_at']);
  assert.match(read('supabase/migrations/20261028090100_trust.sql'), /grant select \(blocker_id, blocked_id, created_at\) on public\.blocks/);
});

// ---- Subscriptions and deleting the account --------------------------------------------------------------

function sub(patch: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    store: 'app_store', product_id: 'reeltale.plus.monthly', tier: 'plus', period_type: 'normal', status: 'active',
    period_start: new Date(NOW.getTime() - 10 * DAY).toISOString(), period_end: new Date(NOW.getTime() + 20 * DAY).toISOString(),
    auto_renew: true, environment: 'production', ...patch,
  };
}

test('subscription rows are read defensively', () => {
  assert.equal(parseSubscriptions(undefined), null);
  const rows = parseSubscriptions([sub({}), { store: 'carrier_pigeon', tier: 'plus', status: 'active' }, 7, { ...sub({}), tier: 'gold' }]);
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0]?.tier, 'plus');
});

test('VIP is active like the database says: status active and a period that has not ended', () => {
  assert.equal(activeSubscription([], NOW), null);
  assert.equal(activeSubscription(undefined, NOW), null);
  assert.equal(activeSubscription([sub({ status: 'expired' })], NOW), null);
  assert.equal(activeSubscription([sub({ status: 'refunded' })], NOW), null);
  assert.equal(activeSubscription([sub({ period_end: new Date(NOW.getTime() - 1).toISOString() })], NOW), null);
  assert.equal(activeSubscription([sub({ period_end: null })], NOW), null);
  assert.equal(activeSubscription([sub({ tier: 'plus' }), sub({ tier: 'premium' })], NOW)?.tier, 'premium');
  assert.equal(activeSubscription([sub({})], NOW)?.tier, 'plus');
});

test('the deletion warning is for a subscription that would keep billing', () => {
  assert.equal(renewingSubscription([sub({})], NOW)?.store, 'app_store');
  assert.equal(renewingSubscription([sub({ auto_renew: false })], NOW), null);
  assert.equal(renewingSubscription([sub({ status: 'expired' })], NOW), null);
  assert.equal(renewingSubscription([sub({ status: 'billing_issue', period_end: new Date(NOW.getTime() - DAY).toISOString() })], NOW)?.status, 'billing_issue');
  assert.equal(renewingSubscription([sub({ status: 'paused' })], NOW), null);
  assert.equal(renewingSubscription(undefined, NOW), null);
});

// Found in review: the notice used to show only for a known renewing subscription or a failed lookup, so
// while the list was still loading "Continue" led straight to the typed word with no word about billing.
test('the delete page always says a subscription keeps billing, and names the store only when it knows one', () => {
  const generic = {
    titleKey: 'settings:delete.subscription.titleGeneric', bodyKey: 'settings:delete.subscription.bodyGeneric',
    storeKey: null, manageStore: null,
  };
  assert.deepEqual(deletionNotice(undefined, NOW), generic); // still loading, or the lookup failed
  assert.deepEqual(deletionNotice([], NOW), generic);
  assert.deepEqual(deletionNotice([sub({ auto_renew: false })], NOW), generic);
  assert.deepEqual(deletionNotice([sub({})], NOW), {
    titleKey: 'settings:delete.subscription.title', bodyKey: 'settings:delete.subscription.body',
    storeKey: 'settings:delete.stores.app_store', manageStore: 'app_store',
  });
  assert.equal(deletionNotice([sub({ store: 'play_store' })], NOW).manageStore, 'play_store');
  // A web subscription: known, but no store to name or open.
  assert.deepEqual(deletionNotice([sub({ store: 'web' })], NOW), {
    titleKey: 'settings:delete.subscription.title', bodyKey: 'settings:delete.subscription.bodyUnnamed',
    storeKey: null, manageStore: null,
  });
});

test('the store pages open for the store the subscription came from, and the web has none', () => {
  assert.equal(manageSubscriptionUrl('app_store'), 'https://apps.apple.com/account/subscriptions');
  assert.equal(manageSubscriptionUrl('play_store'), 'https://play.google.com/store/account/subscriptions');
  assert.equal(manageSubscriptionUrl('web'), null);
  assert.equal(storeNameKey('web'), null);
  assert.equal(storeNameKey('app_store'), 'settings:delete.stores.app_store');
});

test('the typed word has to match exactly (extra space around it doesn’t count)', () => {
  assert.ok(isDeleteConfirmed('DELETE', 'DELETE'));
  assert.ok(isDeleteConfirmed('  DELETE ', 'DELETE'));
  assert.ok(!isDeleteConfirmed('delete', 'DELETE'));
  assert.ok(!isDeleteConfirmed('DELET', 'DELETE'));
  assert.ok(!isDeleteConfirmed('', ''));
});

// ---- VIP, redeem, legal, profile ---------------------------------------------------------------------------

test('the VIP numbers come from the pricing config, and what can’t be read keeps its default', () => {
  assert.deepEqual(parseVipConfig(null), VIP_DEFAULTS);
  assert.deepEqual(parseVipConfig([]), VIP_DEFAULTS);
  assert.equal(parseVipConfig([{ key: 'plus_discount_pct', value: 15 }]).discountPct, 15);
  assert.equal(parseVipConfig([{ key: 'plus_discount_pct', value: '12' }]).discountPct, 12);
  assert.equal(parseVipConfig([{ key: 'plus_discount_pct', value: 'lots' }]).discountPct, VIP_DEFAULTS.discountPct);
  assert.equal(parseVipConfig([{ key: 'plus_discount_pct', value: 95 }]).discountPct, VIP_DEFAULTS.discountPct);
  assert.equal(parseVipConfig([{ key: 'free_passes_plus_bonus', value: 2 }]).extraFreePasses, 2);
  assert.equal(parseVipConfig([{ key: 'free_passes_plus_bonus', value: -1 }]).extraFreePasses, VIP_DEFAULTS.extraFreePasses);
  assert.equal(parseVipConfig([{ key: 'other', value: 1 }, 5, null]).coins, VIP_DEFAULTS.coins);
});

test('access codes: spaces out, the Worker’s format, and the messages for each outcome', () => {
  assert.equal(normalizeCode(' ab c-12 3\n'), 'abc-123');
  assert.ok(isCodeFormat('JUDGE-2026'));
  assert.ok(!isCodeFormat('SHORT'));
  assert.ok(!isCodeFormat('has space'));
  assert.ok(!isCodeFormat('x'.repeat(41)));
  assert.ok(!isCodeFormat('émoji-code'));
  assert.equal(parseSiteKey(' 1x00000000000000000000AA '), '1x00000000000000000000AA');
  assert.equal(parseSiteKey(undefined), null);
  assert.equal(parseSiteKey('short'), null);
  assert.equal(parseSiteKey('has space in the key'), null);

  const res = (r: unknown) => RedeemResponseSchema.parse(r);
  assert.deepEqual(redeemMessages(res({ status: 'already_redeemed' })), [{ key: 'redeem:success.already', params: {} }]);
  const both = redeemMessages(res({ status: 'redeemed', coins: 1500, coins_expire_at: '2026-11-15T00:00:00Z', ai_days: 7 }), 'en');
  assert.deepEqual(both.map((m) => m.key), ['redeem:success.coins', 'redeem:success.ai']);
  assert.equal(both[0]?.params.count, 1500);
  assert.match(String(both[0]?.params.date), /Nov/);
  assert.equal(both[1]?.params.count, 7);
  assert.deepEqual(redeemMessages(res({ status: 'redeemed', coins: 10, coins_expire_at: null, ai_days: 0 })).map((m) => m.key), ['redeem:success.coinsOnly']);
  assert.deepEqual(redeemMessages(res({ status: 'redeemed', coins: 0, ai_days: 3 })).map((m) => m.key), ['redeem:success.ai']);
  assert.deepEqual(redeemMessages(res({ status: 'redeemed' })).map((m) => m.key), ['redeem:success.done']);
});

test('the legal pages are the five hosted ones, each with a label', () => {
  assert.deepEqual([...LEGAL_PAGES], ['terms', 'privacy', 'community', 'ai-policy', 'coins-refunds']);
  for (const slug of LEGAL_PAGES) {
    assert.equal(legalUrl(slug), `https://eurastudios.com/apps/reeltale/${slug}/`);
    assert.ok(LEGAL_LABEL_KEYS[slug].startsWith('settings:legal.'));
  }
  assert.ok(LEGAL_BASE.startsWith('https://'));
});

test('the profile placeholder uses the name, else the handle, else nothing', () => {
  assert.equal(displayNameOf({ display_name: ' Mara ', handle: 'mara_x' }), 'Mara');
  assert.equal(displayNameOf({ display_name: null, handle: 'mara_x' }), 'mara_x');
  assert.equal(displayNameOf({ display_name: '  ', handle: null }), null);
  assert.equal(displayNameOf(null), null);
  assert.equal(handleText({ handle: 'mara_x' }), '@mara_x');
  assert.equal(handleText({ handle: null }), null);
  assert.equal(initialOf({ display_name: 'mara', handle: null }), 'M');
  assert.equal(initialOf({ display_name: '😀 Smile', handle: null }), '😀');
  assert.equal(initialOf(undefined), '');
});
