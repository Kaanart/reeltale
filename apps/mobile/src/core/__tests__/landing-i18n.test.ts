import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_STEPS, VOICE_STEP } from '../../features/landing/logic/landing.ts';
import { NOTICE_REASONS, NOTICE_TARGET_TYPES, reasonLabelKey, targetLabelKey } from '../../features/landing/logic/notice.ts';
import { PUBLIC_WEB_PATHS } from '../../lib/gate.ts';

// The public web pages (features/landing: the landing page at '/', /about, /notice): every string key
// exists and every string is used, no hard-coded English or raw colours, the native apps get only stubs,
// and the security rules hold (one external script origin, nothing stored, nothing logged, the CSP intact).

const src = fileURLToPath(new URL('../../', import.meta.url));
const dir = join(src, 'features/landing');
const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => f.slice(src.length);

function walk(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}
const files = walk(dir);
const components = files.filter((f) => f.endsWith('.tsx'));

type Tree = { [key: string]: Tree | string };
const strings: Record<string, Tree> = {};
const i18nDir = join(src, 'i18n/en');
for (const file of readdirSync(i18nDir).filter((f) => f.endsWith('.json'))) {
  strings[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(i18nDir, file), 'utf8')) as Tree;
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

function leaves(tree: Tree, prefix: string): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
}

/** Keys the code builds at run time, by family (each one is checked against its source of truth below). */
const DYNAMIC_FAMILIES = ['landing:ai.steps.', 'landing:how.steps.', 'notice:reasons.', 'notice:targets.'];

test('the public pages and their routes are there', () => {
  const names = files.map(rel);
  for (const name of [
    'features/landing/LandingScreen.tsx', 'features/landing/LandingScreen.web.tsx', 'features/landing/AboutScreen.tsx',
    'features/landing/AboutScreen.web.tsx', 'features/landing/NoticeScreen.tsx', 'features/landing/NoticeScreen.web.tsx',
  ]) assert.ok(names.includes(name), name);
  // '/' for visitors lives in the (auth) group; /about and /notice at the root. All three are the public paths.
  assert.match(read(join(src, 'app/(auth)/index.tsx')), /from '\.\.\/\.\.\/features\/landing\/LandingScreen'/);
  assert.match(read(join(src, 'app/about.tsx')), /from '\.\.\/features\/landing\/AboutScreen'/);
  assert.match(read(join(src, 'app/notice.tsx')), /from '\.\.\/features\/landing\/NoticeScreen'/);
  assert.deepEqual([...PUBLIC_WEB_PATHS], ['/', '/about', '/notice']);
});

test('every literal i18n key on the public pages exists', () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of files) {
    for (const m of read(file).matchAll(/['`]([a-z]+:[A-Za-z0-9_.]+)['`]/g)) {
      const key = m[1]!;
      if (!(key.split(':')[0]! in strings)) continue;
      count += 1;
      if (!resolves(key)) missing.push(`${rel(file)}: ${key}`);
    }
  }
  assert.ok(count >= 60, `only ${count} keys found: is the scan broken?`);
  assert.deepEqual(missing, []);
});

test('keys built at run time all exist: AI steps, how-it-works steps, reasons, target types', () => {
  for (const s of [...AI_STEPS, VOICE_STEP]) {
    assert.ok(resolves(s.titleKey), s.titleKey);
    assert.ok(resolves(s.bodyKey), s.bodyKey);
  }
  for (const key of ['watch', 'unlock', 'create']) {
    assert.ok(resolves(`landing:how.steps.${key}.title`), key);
    assert.ok(resolves(`landing:how.steps.${key}.body`), key);
  }
  for (const r of NOTICE_REASONS) assert.ok(resolves(reasonLabelKey(r)), r);
  for (const type of NOTICE_TARGET_TYPES) assert.ok(resolves(targetLabelKey(type)), type);
  // And nothing else lives in those families.
  const landing = strings.landing as { ai: { steps: Tree }; how: { steps: Tree } };
  assert.deepEqual(Object.keys(landing.ai.steps).sort(), [...AI_STEPS, VOICE_STEP].map((s) => s.key).sort());
  assert.deepEqual(Object.keys(landing.how.steps).sort(), ['create', 'unlock', 'watch']);
  const notice = strings.notice as { reasons: Tree; targets: Tree };
  assert.deepEqual(Object.keys(notice.reasons).sort(), NOTICE_REASONS.map((r) => reasonLabelKey(r).split('.').at(-1)).sort());
  assert.deepEqual(Object.keys(notice.targets).sort(), [...NOTICE_TARGET_TYPES].sort());
});

test('every string in landing, about and notice is used', () => {
  const source = files.map(read).join('\n');
  const unused: string[] = [];
  for (const ns of ['landing', 'about', 'notice']) {
    for (const path of leaves(strings[ns]!, '')) {
      const key = `${ns}:${path.replace(/_(one|other)$/, '')}`;
      if (DYNAMIC_FAMILIES.some((family) => key.startsWith(family))) continue;
      if (![`'${key}'`, `"${key}"`, `\`${key}\``].some((quoted) => source.includes(quoted))) unused.push(key);
    }
  }
  assert.deepEqual(unused, []);
});

test('the public pages carry no hard-coded user-facing English and no raw colours', () => {
  const offenders: string[] = [];
  for (const file of components) {
    const text = read(file);
    for (const m of text.matchAll(/(?<![=-])>\s*([A-Za-z0-9][^<>{}\n()]*?)\s*<\//g)) offenders.push(`${rel(file)}: ${m[1]}`);
    for (const m of text.matchAll(/\b(label|title|accessibilityLabel|accessibilityHint|placeholder|aria-label)="([^"]+)"/g)) {
      offenders.push(`${rel(file)}: ${m[1]}="${m[2]}"`);
    }
  }
  assert.deepEqual(offenders, []);
  const colours = files.filter((f) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(read(f))).map(rel);
  assert.deepEqual(colours, []);
});

test('the native apps get stubs only: no web-only strings, no Turnstile, no form', () => {
  for (const name of ['LandingScreen.tsx', 'AboutScreen.tsx', 'NoticeScreen.tsx']) {
    const text = read(join(dir, name)).replace(/^\s*\/\/.*$/gm, ''); // code only, not the comments
    assert.match(text, /<Redirect /, name);
    assert.doesNotMatch(text, /useTranslation|\bt\(|Turnstile|sendNotice|react-i18next/, name);
  }
  // The widget and the form are reachable from the web screen only.
  const importers = files.filter((f) => /from '\.\/components\/Turnstile'|from '\.\.\/components\/Turnstile'/.test(read(f))).map(rel);
  assert.deepEqual(importers, ['features/landing/NoticeScreen.web.tsx']);
  // The web screens are only ever reached through the platform-neutral names (Metro picks .web on the web).
  for (const route of ['app/(auth)/index.tsx', 'app/about.tsx', 'app/notice.tsx']) {
    assert.doesNotMatch(read(join(src, route)), /\.web['"]/, route);
  }
  for (const route of ['app/(auth)/index.web.tsx', 'app/about.web.tsx', 'app/notice.web.tsx']) {
    assert.equal(existsSync(join(src, route)), false, `${route}: the screens resolve per platform; no second route file`);
  }
});

test('one external script origin (Turnstile), nothing stored, nothing logged', () => {
  for (const file of files) {
    const text = read(file);
    const name = rel(file);
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|innerHTML|eval\(|new Function|document\.write/, name);
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|AsyncStorage|SecureStore|document\.cookie|demoState\(/, name);
    assert.doesNotMatch(text, /console\./, name);
    const code = text.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, ''); // origins named in comments don't load anything
    for (const m of code.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      // `https://${text}` in logic/notice.ts only parses what the notifier pasted; nothing is fetched from it.
      if (/^https?:\/\/\$\{/.test(m[0])) continue;
      const origin = new URL(m[0].replace(/\$\{.*$/, '')).origin;
      assert.ok(origin === 'https://challenges.cloudflare.com' || origin === 'https://reeltale.invalid', `${name} names ${m[0]}`);
    }
  }
  const widget = read(join(dir, 'components/Turnstile.tsx'));
  assert.match(widget, /const SCRIPT_ORIGIN = 'https:\/\/challenges\.cloudflare\.com'/);
  assert.match(widget, /createElement\('script'\)/);
  assert.doesNotMatch(widget, /\.(text|textContent|innerText) = /, 'no inline script bodies');
});

test('the CSP still allows exactly what the notice form needs, and no inline scripts', () => {
  const http = readFileSync(new URL('../../../../server/src/lib/http.ts', import.meta.url), 'utf8');
  assert.match(http, /"script-src 'self' https:\/\/challenges\.cloudflare\.com"/);
  assert.match(http, /'frame-src https:\/\/challenges\.cloudflare\.com'/);
  assert.match(http, /"form-action 'self'"/);
  assert.doesNotMatch(/script-src[^"]*/.exec(http)?.[0] ?? '', /unsafe-inline|unsafe-eval/);
});

test('the notice form sends what the Worker checks: action "report", no session, same origin', () => {
  const screen = read(join(dir, 'NoticeScreen.web.tsx'));
  const server = readFileSync(new URL('../../../../server/src/routes/report.ts', import.meta.url), 'utf8');
  assert.match(screen, /action="report"/);
  assert.match(server, /expectedAction: 'report'/);
  assert.match(screen, /sendNotice\(body, \{ origin: window\.location\.origin \}\)/);
  // Demo builds never load the widget or send anything.
  assert.match(screen, /if \(demo\) \{\s*finish\('demo'\);\s*return;\s*\}/);
  assert.match(screen, /!demo && TURNSTILE_SITE_KEY \?/);
  // The fields are cleared once the notice is sent.
  assert.match(screen, /const finish = \(kind: Sent\) => \{\s*setDraft\(EMPTY_DRAFT\);/);
});

test('AI content on the landing page carries the AI badge', () => {
  const landing = read(join(dir, 'LandingScreen.web.tsx'));
  const hero = read(join(dir, 'components/HeroVisual.tsx'));
  assert.match(landing, /<AIBadge/);
  // The AI panel in the hero picture and the living-comics card both show it.
  assert.match(hero, /demoPanelImage[\s\S]*<AIBadge/);
  assert.match(landing, /aiComics[^\n]*\bai\b/);
});
