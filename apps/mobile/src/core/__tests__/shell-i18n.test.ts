import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The web shell (src/components/layout): every literal i18n key exists, no hard-coded English, no raw colours,
// the footer's links are the ones the product needs, and the security rules hold (no inline scripts, no new
// external origins).

const src = fileURLToPath(new URL('../../', import.meta.url));
const dir = join(src, 'components/layout');
const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, f));
const read = (f: string) => readFileSync(f, 'utf8');

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

test('the shell files are there', () => {
  const names = files.map((f) => f.slice(dir.length + 1)).sort();
  for (const name of ['PageContainer.tsx', 'ResponsiveGrid.tsx', 'SiteFooter.tsx', 'SiteHeader.tsx', 'SiteShell.tsx', 'TwoColumn.tsx', 'logic.ts', 'useLayout.ts', 'usePageTitle.ts']) {
    assert.ok(names.includes(name), name);
  }
});

test('every literal i18n key in the shell exists', () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of files) {
    for (const m of read(file).matchAll(/['`]([a-z]+:[A-Za-z0-9_.]+)['`]/g)) {
      const key = m[1]!;
      if (!(key.split(':')[0]! in strings)) continue;
      count += 1;
      if (!resolves(key)) missing.push(`${file.slice(src.length)}: ${key}`);
    }
  }
  assert.ok(count >= 20, `only ${count} keys found: is the scan broken?`);
  assert.deepEqual(missing, []);
});

test('the shell carries no hard-coded user-facing English', () => {
  const offenders: string[] = [];
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const text = read(file);
    for (const m of text.matchAll(/(?<![=-])>\s*([A-Za-z][^<>{}\n()]*?)\s*<\//g)) offenders.push(`${file.slice(src.length)}: ${m[1]}`);
    for (const m of text.matchAll(/\b(label|title|accessibilityLabel|accessibilityHint|placeholder|aria-label)="([^"]+)"/g)) {
      offenders.push(`${file.slice(src.length)}: ${m[1]}="${m[2]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the shell uses tokens, not raw colours', () => {
  const offenders = files.filter((f) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(read(f))).map((f) => f.slice(src.length));
  assert.deepEqual(offenders, []);
});

test('the footer links About, the four legal pages, and Report illegal content; and states who makes it and for whom', () => {
  const footer = read(join(dir, 'SiteFooter.tsx'));
  for (const slug of ['terms', 'privacy', 'community', 'ai-policy']) assert.match(footer, new RegExp(`slug: '${slug}'`));
  assert.match(footer, /legalUrl\(doc\.slug\)/, 'legal pages come from the existing links helper');
  assert.match(footer, /ABOUT_PATH = '\/about'/);
  assert.match(footer, /NOTICE_PATH = '\/notice'/);
  const common = strings.common as { footer: Record<string, string> };
  assert.equal(common.footer.imprint, 'ReelTale is made by Euragnos B.V., the Netherlands');
  assert.equal(common.footer.adultsOnly, 'For adults 18+');
  assert.equal(common.footer.notice, 'Report illegal content');
  // External links open in a new tab with no opener, and say so to screen readers.
  const link = read(join(dir, 'ShellLink.tsx'));
  assert.match(link, /target="_blank" rel="noopener noreferrer"/);
  assert.match(footer, /common:footer\.newTab/);
});

test('the shell adds no scripts and no new origins (the CSP stays as it is)', () => {
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|<script|eval\(|new Function/, file);
    for (const m of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) assert.fail(`${file.slice(src.length)} names an origin: ${m[0]}`);
  }
});

test('the top bar marks the current page for assistive tech and is a landmark', () => {
  const header = read(join(dir, 'SiteHeader.tsx'));
  assert.match(header, /role="banner"/);
  assert.match(header, /role="navigation"/);
  assert.match(header, /current=\{match === 'page' \? 'page'/);
  const link = read(join(dir, 'ShellLink.tsx'));
  assert.match(link, /'aria-current'/);
  assert.match(link, /:focus-visible/);
  const footer = read(join(dir, 'SiteFooter.tsx'));
  assert.match(footer, /role="contentinfo"/);
});
