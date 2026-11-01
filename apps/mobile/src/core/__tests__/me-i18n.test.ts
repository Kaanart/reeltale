import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reasonLabelKey, REPORT_REASONS, REPORT_TARGET_TYPES } from '../../features/me/logic/report.ts';
import { AI_CONSENT_PURPOSES } from '../../features/me/logic/consent.ts';
import { bonusGroup } from '../wallet.ts';

// The Me track's screens: every i18n key they use exists, none holds user-facing English of its own, and the
// web-only redeem screen is the only thing that mentions codes (App Store 3.1.1).

const src = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = [
  'features/me', 'app/(tabs)/me.tsx', 'app/wallet.tsx', 'app/vip.tsx', 'app/settings', 'app/report.tsx',
  'app/redeem.tsx', 'app/redeem.web.tsx',
];

function files(path: string): string[] {
  const full = join(src, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

const sources = ROOTS.flatMap(files).filter((f) => /\.tsx?$/.test(f));
const rel = (f: string) => f.slice(src.length);

type Tree = { [key: string]: Tree | string };
const strings: Record<string, Tree> = {};
const dir = new URL('../../i18n/en/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  strings[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Tree;
}

function resolves(key: string): boolean {
  const [ns, path] = key.split(':');
  let node: Tree | string | undefined = ns ? strings[ns] : undefined;
  for (const part of (path ?? '').split('.')) {
    if (!node || typeof node === 'string') return false;
    node = node[part] ?? node[`${part}_other`];
  }
  return typeof node === 'string';
}

test('the Me files exist and are scanned', () => {
  assert.ok(sources.length > 30, `${sources.length} files`);
  for (const name of ['redeem.tsx', 'redeem.web.tsx']) assert.ok(sources.some((f) => f.endsWith(`app/${name}`)), name);
});

test('every literal i18n key the Me track uses exists', () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['`]([a-z]+:[A-Za-z0-9_.]+)['`]/g)) {
      const key = m[1]!;
      if (!(key.split(':')[0]! in strings)) continue;
      count += 1;
      if (!resolves(key)) missing.push(`${rel(file)}: ${key}`);
    }
  }
  assert.ok(count > 80, `only ${count} keys found: is the scan broken?`);
  assert.deepEqual(missing, []);
});

test('every key the Me track builds from a value exists for every value', () => {
  const missing: string[] = [];
  const check = (key: string) => { if (!resolves(key)) missing.push(key); };
  for (const r of REPORT_REASONS) check(reasonLabelKey(r));
  for (const t of REPORT_TARGET_TYPES) check(`report:target.${t}`);
  for (const p of AI_CONSENT_PURPOSES) { check(`settings:aiConsents.${p.textKey}.title`); check(`settings:aiConsents.${p.textKey}.body`); }
  for (const m of ['apple', 'google', 'email', 'password', 'demo']) check(`settings:account.methods.${m}`);
  for (const t of ['plus', 'premium']) check(`vip:plan.${t}`);
  check('vip:period.month');
  for (const g of new Set(['iap', 'web', 'sub_grant', 'trial', 'promo', 'code', 'sandbox', 'refund_return', 'admin'].map(bonusGroup))) check(`wallet:source.${g}`);
  assert.deepEqual(missing, []);
  // The templates really are in the code (so this list can't go stale unnoticed).
  const all = sources.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const template of ['report:reasons.${reason ===', 'report:target.${target.type}', 'settings:aiConsents.${info.textKey}.title', 'settings:account.methods.${method}', 'vip:period.${perks.period}', 'vip:plan.${tier}', 'wallet:source.${group}']) {
    assert.ok(all.includes(template), template);
  }
});

test('the Me screens carry no hard-coded user-facing English', () => {
  const offenders: string[] = [];
  for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?<![=-])>\s*([A-Za-z][^<>{}\n()]*?)\s*<\//g)) offenders.push(`${rel(file)}: ${m[1]}`);
    for (const m of text.matchAll(/\b(label|title|accessibilityLabel|accessibilityHint|placeholder)="([^"]+)"/g)) {
      offenders.push(`${rel(file)}: ${m[1]}="${m[2]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ---- Codes exist on the web only -----------------------------------------------------------------------

const WEB_ONLY = (f: string) => rel(f).startsWith('features/me/redeem/') || rel(f).endsWith('RedeemLink.web.tsx') || rel(f).endsWith('app/redeem.web.tsx');

test('only web-only files use the redeem namespace or the access-code logic', () => {
  const offenders = sources
    .filter((f) => !WEB_ONLY(f))
    .filter((f) => /['`]redeem:|redeem\/|redeemCode|codes\/redeem|turnstile/i.test(readFileSync(f, 'utf8')))
    // The native route may mention the screen it hides.
    .filter((f) => !rel(f).endsWith('app/redeem.tsx') || /import /.test(readFileSync(f, 'utf8').replace(/import \{ Redirect \} from 'expo-router';/, '')))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('the native redeem route only sends people Home', () => {
  const text = readFileSync(join(src, 'app/redeem.tsx'), 'utf8');
  assert.match(text, /<Redirect href="\/" \/>/);
  assert.doesNotMatch(text, /features\/me/);
  // RedeemLink has a native version that shows nothing, and a web one that shows the link.
  assert.match(readFileSync(join(src, 'features/me/components/RedeemLink.tsx'), 'utf8'), /return null;/);
  assert.doesNotMatch(readFileSync(join(src, 'features/me/components/RedeemLink.tsx'), 'utf8'), /redeem:/);
});

// Expo Router bundles `app/redeem.web.tsx` on iOS and Android too (its route context matches every file),
// with everything it imports. Found by exporting the iOS bundle: the screen, the Turnstile loader and the
// redeem call were all in it. So the route imports the screen by a name that has a native stub.
test('the native redeem screen is a stub, and only .web files import the real redeem code', () => {
  const stub = readFileSync(join(src, 'features/me/redeem/RedeemScreen.tsx'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.match(stub, /<Redirect href="\/" \/>/);
  assert.doesNotMatch(stub, /redeem:|redeemLogic|siteKey|Turnstile|lib\/|auth/);
  assert.ok(sources.some((f) => f.endsWith('features/me/redeem/RedeemScreen.web.tsx')));
  // The route reaches the screen through the platform-resolved name, never through a file of its own.
  assert.match(readFileSync(join(src, 'app/redeem.web.tsx'), 'utf8'), /from '\.\.\/features\/me\/redeem\/RedeemScreen'/);

  const real = /from '[^']*\/(redeemLogic|siteKey|Turnstile)'/;
  const offenders = sources
    .filter((f) => real.test(readFileSync(f, 'utf8')))
    .filter((f) => !f.endsWith('.web.tsx') && !f.endsWith('features/me/redeem/siteKey.ts'))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('the web redeem screen makes no request in demo mode (no Turnstile script, no call)', () => {
  const text = readFileSync(join(src, 'features/me/redeem/RedeemScreen.web.tsx'), 'utf8');
  assert.match(text, /isDemo \? null : TURNSTILE_SITE_KEY/);
});

test('the wallet and VIP screens show nothing to buy and no money amounts', () => {
  const wallet = readFileSync(join(src, 'features/me/screens/WalletScreen.tsx'), 'utf8');
  const vip = readFileSync(join(src, 'features/me/screens/VipScreen.tsx'), 'utf8');
  for (const text of [wallet, vip]) {
    assert.doesNotMatch(text, /wallet:store\.|vip:(price|subscribe|subscribing|start|trial|autoRenew|chargedAt)|purchase|Purchases|RevenueCat|currency|formatMicros/i);
    assert.doesNotMatch(text, /[€£]|\$\d/);
  }
  assert.match(wallet, /wallet:comingSoon/);
  assert.match(vip, /vip:comingSoon/);
});

test('AI scenes in the report modal carry the AI badge', () => {
  const text = readFileSync(join(src, 'features/me/screens/ReportScreen.tsx'), 'utf8');
  assert.match(text, /type === 'ai_scene' \? <AIBadge/);
});

// ---- Found in review -----------------------------------------------------------------------------------

test('Me text is never written in the danger red: it is under AA on paper, so red is for icons and edges', () => {
  const tokens = readFileSync(join(src, 'theme/tokens.ts'), 'utf8');
  const hex = (name: string) => new RegExp(`\\b${name}: '#([0-9A-Fa-f]{6})'`).exec(tokens)?.[1] ?? '';
  const lum = (h: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  // While the token stays below 4.5:1 on the page colour, no Me screen may use it for words.
  if (ratio(hex('danger'), hex('bg')) < 4.5) {
    const offenders = sources.filter((f) => /color="danger"/.test(readFileSync(f, 'utf8'))).map(rel);
    assert.deepEqual(offenders, []);
  }
});

// Found in review (second pass): the off track of every Me switch was the hairline colour, 1.3:1 on the card, so
// the switch all but vanished (WCAG 1.4.11 asks 3:1 for the parts of a control that show its state); and the
// placeholder avatar's letter was read out, because accessible={false} hides no children on iOS or the web.
test('Me switches show their track at 3:1 or more, and the decorative avatar is hidden from screen readers', () => {
  const tokens = readFileSync(join(src, 'theme/tokens.ts'), 'utf8');
  const hex = (name: string) => new RegExp(`\\b${name}: '#([0-9A-Fa-f]{6})'`).exec(tokens)?.[1] ?? '';
  const lum = (h: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const rows = readFileSync(join(src, 'features/me/components/Rows.tsx'), 'utf8');
  const track = /trackColor=\{\{ false: colors\.(\w+), true: colors\.(\w+) \}\}/.exec(rows);
  assert.ok(track, 'the switch track colours are tokens');
  for (const name of [track[1]!, track[2]!]) {
    assert.ok(ratio(hex(name), hex('surface')) >= 3, `${name} on surface: ${ratio(hex(name), hex('surface')).toFixed(2)}:1`);
  }
  assert.match(rows, new RegExp(`ios_backgroundColor=\\{colors\\.${track[1]}\\}`));
  const avatar = readFileSync(join(src, 'features/me/components/Avatar.tsx'), 'utf8');
  assert.match(avatar, /<View style=\{styles\.circle\} aria-hidden>/);
});

test('the web opens legal and store pages in a normal new tab (expo-web-browser makes a popup there)', () => {
  const native = readFileSync(join(src, 'features/me/links.ts'), 'utf8');
  const web = readFileSync(join(src, 'features/me/links.web.ts'), 'utf8');
  const exported = (text: string) => [...text.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported(web), exported(native));
  assert.doesNotMatch(web, /from 'expo-web-browser'/);
  assert.match(web, /Linking\.openURL/);
});

test('changing an AI consent in Settings also refreshes the story feature’s cached answer', () => {
  const hooks = readFileSync(join(src, 'features/me/hooks.ts'), 'utf8');
  const story = readFileSync(join(src, 'features/story/hooks.ts'), 'utf8');
  // The key the story feature uses, and the one Settings invalidates, are the same.
  assert.match(story, /consent: \(u: Id\) => userKey\(u, 'story', 'consent'\)/);
  assert.match(hooks, /invalidateQueries\(\{ queryKey: userKey\(userId, 'story', 'consent'\) \}\)/);
});
