import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_LOGIC_KEYS } from '../../features/story/logic.ts';
import { JOB_KEYS, JOB_STEPS } from '../jobs.ts';

// The AI story track's screens: every i18n key they use exists, the keys built from a value exist for
// every value, none of the screens holds user-facing English of its own, and nothing in them offers
// anything to buy (coins are only ever spent here; buying them is the store's job).

const src = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = ['features/story', 'app/(tabs)/create.tsx', 'app/story'];

function files(path: string): string[] {
  const full = join(src, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

const sources = ROOTS.flatMap(files).filter((f) => /\.tsx?$/.test(f));
const rel = (f: string) => f.slice(src.length);
const all = sources.map((f) => readFileSync(f, 'utf8')).join('\n');

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

test('the story files exist and are scanned', () => {
  assert.ok(sources.length > 20, `${sources.length} files`);
  for (const route of ['app/(tabs)/create.tsx', 'app/story/new.tsx', 'app/story/[id].tsx']) {
    assert.ok(sources.some((f) => rel(f) === route), route);
  }
});

test('the routes are thin: each re-exports a screen from features/story', () => {
  for (const route of ['app/(tabs)/create.tsx', 'app/story/new.tsx', 'app/story/[id].tsx']) {
    const text = readFileSync(join(src, route), 'utf8').trim();
    assert.match(text, /^export \{ \w+Screen as default \} from '\.\.\/\.\.\/features\/story\/screens\/\w+Screen';$/, route);
  }
});

test('every literal i18n key the story track uses exists', () => {
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
  assert.ok(count > 60, `only ${count} keys found: is the scan broken?`);
  assert.deepEqual(missing, []);
});

test('every key the story track builds from a value exists for every value', () => {
  const missing: string[] = [];
  const check = (key: string) => { if (!resolves(key)) missing.push(key); };
  for (const key of STORY_LOGIC_KEYS) check(key);
  for (const key of JOB_KEYS) check(key);
  for (const step of JOB_STEPS) check(`ai:progress.${step}`);
  for (const idea of ['lighthouse', 'market', 'train']) check(`story:new.opening.ideas.${idea}`);
  assert.deepEqual(missing, []);
  // The templates really are in the code (so this list can't go stale unnoticed).
  for (const template of ['story:new.opening.ideas.${idea}', 'ai:progress.${step}']) assert.ok(all.includes(template), template);
  assert.ok(all.includes("const IDEAS = ['lighthouse', 'market', 'train'] as const;"), 'IDEAS list');
});

test('the story screens carry no hard-coded user-facing English', () => {
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

test('the story screens never show err.message, only describeError keys', () => {
  const offenders = sources.filter((f) => /\b(err|error|e)\??\.message\b/.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(offenders, []);
});

test('nothing in the story screens is for sale: no store, no money, no codes, no "get coins" button', () => {
  // story:new.confirm.getCoins exists for when in-app purchase is built; until then no screen may use it.
  const offenders = sources
    .filter((f) => /getCoins|redeem|purchase|revenuecat|['"`]\/(wallet|vip)\b|price_eur|currency/i.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('every story screen shows the AI label', () => {
  for (const screen of ['NewStoryScreen', 'StoryPlayerScreen', 'CreateScreen']) {
    const text = readFileSync(join(src, `features/story/screens/${screen}.tsx`), 'utf8');
    assert.ok(text.includes('<AIBadge'), screen);
  }
});

test('the consent text names every provider the app sends story text to', () => {
  const body = (strings.create as Tree & { consent: { ai: { body: string } } }).consent.ai.body;
  for (const name of ['Meta', 'Google']) assert.ok(body.includes(name), name);
});

test('every failure message says the coins came back', () => {
  const failure = (strings.ai as { failure: Record<string, string> }).failure;
  for (const [key, text] of Object.entries(failure)) assert.match(text, /refunded/, key);
});

test('private panel pictures are cached in memory only, never on the device disk', () => {
  const stage = readFileSync(join(src, 'features/story/components/ComicStage.tsx'), 'utf8');
  const images = [...stage.matchAll(/<Image\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.ok(images.length > 0, 'the stage draws panels with expo-image');
  for (const image of images) assert.match(image, /cachePolicy="memory"/);
});

test('a story opened without a scene names the scene it opened at in its route', () => {
  // So the screen doesn't drift to a newer scene later, and "Try another choice" in a child finds it (sceneBelow).
  const player = readFileSync(join(src, 'features/story/screens/StoryPlayerScreen.tsx'), 'utf8');
  assert.match(player, /if \(!sceneParam && latest\.data\) navigation\.setParams\(\{ scene: latest\.data \}\)/);
});
