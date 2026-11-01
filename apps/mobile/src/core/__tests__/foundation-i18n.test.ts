import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every literal t('ns:key') in the foundation's screens resolves to an English string, and those screens
// hold no user-facing English of their own.

const src = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = ['app/_layout.tsx', 'app/(auth)', 'app/(tabs)', 'features/auth', 'lib'];

function files(path: string): string[] {
  const full = join(src, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

const sources = ROOTS.flatMap(files).filter((f) => /\.tsx?$/.test(f));

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

test('the foundation files exist and are scanned', () => {
  assert.ok(sources.length > 20, `${sources.length} files`);
});

test('every literal i18n key used by the foundation exists', () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    // t('ns:key'), t(`ns:key`), and keys kept in tables ('common:nav.home').
    for (const m of text.matchAll(/['`]([a-z]+:[A-Za-z0-9_.]+)['`]/g)) {
      const key = m[1]!;
      if (!(key.split(':')[0]! in strings)) continue;
      count += 1;
      if (!resolves(key)) missing.push(`${file.slice(src.length)}: ${key}`);
    }
    // Template keys: every value the template can take must exist.
    if (text.includes('`age:errors.${problem}`')) {
      for (const p of ['invalid_format', 'invalid_date', 'too_old', 'in_future']) {
        if (!resolves(`age:errors.${p}`)) missing.push(`age:errors.${p}`);
      }
    }
  }
  assert.ok(count > 40, `only ${count} keys found: is the scan broken?`);
  assert.deepEqual(missing, []);
});

test('screens and layouts carry no hard-coded user-facing English', () => {
  const screens = sources.filter((f) => f.endsWith('.tsx'));
  const offenders: string[] = [];
  for (const file of screens) {
    const text = readFileSync(file, 'utf8');
    // JSX text children: >Words< (not arrows `=> fn<T>(`, comments or {expressions}).
    for (const m of text.matchAll(/(?<![=-])>\s*([A-Za-z][^<>{}\n()]*?)\s*<\//g)) offenders.push(`${file.slice(src.length)}: ${m[1]}`);
    // Common props that are shown or read aloud.
    for (const m of text.matchAll(/\b(label|title|accessibilityLabel|accessibilityHint|placeholder)="([^"]+)"/g)) {
      offenders.push(`${file.slice(src.length)}: ${m[1]}="${m[2]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});
