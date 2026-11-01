import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The watch track's screens: every i18n key they use exists, none holds user-facing English of its own, the
// data rules hold (no Supabase or Worker client in a component, playback only behind the price check), and
// the player and unlock sheet sell nothing (App Store 3.1.1: coins and VIP are in-app purchases only).

const src = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = ['features/watch', 'app/watch'];

function files(path: string): string[] {
  const full = join(src, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

const sources = ROOTS.flatMap(files).filter((f) => /\.tsx?$/.test(f));
const rel = (f: string) => f.slice(src.length);
const read = (f: string) => readFileSync(f, 'utf8');

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

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]): [string, string][] =>
    typeof v === 'string' ? [[prefix + k, v]] : leaves(v, `${prefix}${k}.`));
}

test('the watch files exist and are scanned', () => {
  assert.ok(sources.length >= 20, `${sources.length} files`);
  for (const name of ['app/watch/[episodeId].tsx', 'features/watch/screens/WatchScreen.tsx', 'features/watch/components/UnlockSheet.tsx']) {
    assert.ok(sources.some((f) => rel(f) === name), name);
  }
});

test('every literal i18n key the watch track uses exists', () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of sources) {
    for (const m of read(file).matchAll(/['`]([a-z]+:[A-Za-z0-9_.]+)['`]/g)) {
      const key = m[1]!;
      if (!(key.split(':')[0]! in strings)) continue;
      count += 1;
      if (!resolves(key)) missing.push(`${rel(file)}: ${key}`);
    }
  }
  assert.ok(count > 40, `only ${count} keys found: is the scan broken?`);
  assert.deepEqual(missing, []);
});

test('screens and components carry no hard-coded user-facing English', () => {
  const offenders: string[] = [];
  for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
    const text = read(file);
    for (const m of text.matchAll(/(?<![=-])>\s*([A-Za-z][^<>{}\n()]*?)\s*<\//g)) offenders.push(`${rel(file)}: ${m[1]}`);
    for (const m of text.matchAll(/\b(label|title|message|accessibilityLabel|accessibilityHint|placeholder)="([^"]+)"/g)) {
      offenders.push(`${rel(file)}: ${m[1]}="${m[2]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('components and screens reach data only through the hooks', () => {
  const ui = sources.filter((f) => /\/(components|screens)\//.test(f) || rel(f).startsWith('app/'));
  const hits = ui.filter((f) => /from '[./]*\/lib\/(supabase|api)'|getSupabase\(|\bdb\(\)|\brpc\(/.test(read(f))).map(rel);
  assert.deepEqual(hits, []);
});

test('a playback URL is only requested behind the price check', () => {
  const page = read(join(src, 'features/watch/components/EpisodePage.tsx'));
  const calls = [...page.matchAll(/usePlayback\(([^)]*\)?)\)/g)].map((m) => m[1]);
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? '', /mayRequestPlayback\(/);
  // Nothing else asks the Worker for playback.
  const others = sources.filter((f) => /getPlayback\(|usePlayback\(/.test(read(f)))
    .map(rel)
    .filter((f) => f !== 'features/watch/hooks.ts' && f !== 'features/watch/components/EpisodePage.tsx');
  assert.deepEqual(others, []);
});

test('nothing unlocks by itself: the unlock RPCs run only from the sheet’s buttons', () => {
  const callers = sources.filter((f) => /useUnlockEpisode\(|useFreePass\(/.test(read(f))).map(rel).sort();
  assert.deepEqual(callers, ['features/watch/components/UnlockSheet.tsx', 'features/watch/hooks.ts']);
  const sheet = read(join(src, 'features/watch/components/UnlockSheet.tsx'));
  // The mutations fire from the press handlers only, never from an effect.
  for (const effect of sheet.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) {
    assert.doesNotMatch(effect[1] ?? '', /\.mutate\(/);
  }
});

test('the player and unlock sheet show no money, no store and no other place to buy', () => {
  const texts = [...leaves(strings.watch!).map(([p, s]) => `watch:${p} ${s}`), ...leaves(strings.unlock!).map(([p, s]) => `unlock:${p} ${s}`)];
  const money = texts.filter((s) => /[$€£¥]|\b(usd|eur|gbp|buy|subscribe|web|website|browser|code)\b/i.test(s));
  assert.deepEqual(money, []);
  for (const file of sources) {
    assert.doesNotMatch(read(file), /approx=\{(?!null\})/, `${rel(file)} shows a money estimate next to coins`);
  }
});

test('a failed background refetch never replaces what is already on screen', () => {
  // TanStack Query keeps `data` when a refetch fails but still reports isError / error (status 'error').
  const screen = read(join(src, 'features/watch/screens/WatchScreen.tsx'));
  assert.match(screen, /if \(!data && seriesQ\.isError\)/);
  assert.doesNotMatch(screen, /if \(seriesQ\.isError\)/);
  const page = read(join(src, 'features/watch/components/EpisodePage.tsx'));
  assert.match(page, /priceQ\.error && near && !priceQ\.data/);
});

test('the web pager’s arrow keys stop while another screen is on top of the player', () => {
  // The web stack keeps the player mounted (display: none) under /wallet, /vip or /settings.
  const screen = read(join(src, 'features/watch/screens/WatchScreen.tsx'));
  assert.match(screen, /keyboardEnabled=\{focused && /);
});

test('AI content in the player is always labelled', () => {
  const page = read(join(src, 'features/watch/components/EpisodePage.tsx'));
  assert.match(page, /isAiContent\(series, episode\)/);
  assert.match(page, /<AIBadge /);
  // The unlock sheet covers the page's label while the poster stays in view, so it carries its own.
  const sheet = read(join(src, 'features/watch/components/UnlockSheet.tsx'));
  assert.match(sheet, /isAiContent\(series, episode\)/);
  assert.match(sheet, /<AIBadge /);
});
