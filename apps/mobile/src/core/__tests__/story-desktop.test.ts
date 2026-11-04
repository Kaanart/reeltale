import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComicTimeline } from '../comic.ts';
import { DEMO_VOICE_TRANSCRIPT, demoTemplate } from '../../features/story/demo.ts';
import {
  choiceTakeable, panelStartMs, playerShortcut, PREVIOUS_RESTARTS_MS, previousTarget, type ChoiceView, type KeyPress,
} from '../../features/story/logic.ts';
import { matchVoiceChoice, secondsLeft, VOICE_LOGIC_KEYS, voiceOutcome } from '../../features/story/voiceLogic.ts';

// The AI story on a laptop: the player's keys (Space, the arrows, 1 2 3), panel navigation, and "Say your choice"
// (what a spoken answer does with the choices, and that the microphone is web-only and wired the way the docs say).

const src = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(src, path), 'utf8');

// ---- Keys -----------------------------------------------------------------------------------------------------

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({
  key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: { tag: 'BODY', role: null, editable: false }, inDialog: false,
  ...more,
});

test('Space plays or pauses, the arrows step through panels, 1 2 3 choose', () => {
  assert.deepEqual(playerShortcut(press(' ')), { action: 'toggle' });
  assert.deepEqual(playerShortcut(press('Spacebar')), { action: 'toggle' });
  assert.deepEqual(playerShortcut(press('ArrowLeft')), { action: 'previous' });
  assert.deepEqual(playerShortcut(press('ArrowRight')), { action: 'next' });
  assert.deepEqual(playerShortcut(press('1')), { action: 'choose', index: 0 });
  assert.deepEqual(playerShortcut(press('2')), { action: 'choose', index: 1 });
  assert.deepEqual(playerShortcut(press('3')), { action: 'choose', index: 2 });
  assert.deepEqual(playerShortcut(press(' ', { target: null })), { action: 'toggle' }, 'nothing focused');
  for (const key of ['4', '0', 'a', 'Enter', 'Escape', 'ArrowUp', 'Tab']) assert.equal(playerShortcut(press(key)), null, key);
});

test('keys stay out of the way: typing, browser shortcuts, dialogs, held keys, focused buttons', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    assert.equal(playerShortcut(press('ArrowRight', { [mod]: true })), null, mod);
    assert.equal(playerShortcut(press('1', { [mod]: true })), null, mod);
  }
  assert.equal(playerShortcut(press(' ', { inDialog: true })), null, '"How this scene was made" is open');
  assert.equal(playerShortcut(press('2', { inDialog: true })), null);
  for (const target of [
    { tag: 'INPUT', role: null, editable: false },
    { tag: 'TEXTAREA', role: null, editable: false },
    { tag: 'SELECT', role: null, editable: false },
    { tag: 'DIV', role: 'textbox', editable: false },
    { tag: 'DIV', role: null, editable: true },
  ]) {
    for (const key of [' ', 'ArrowLeft', '1']) assert.equal(playerShortcut(press(key, { target })), null, `${target.tag} ${key}`);
  }
  // Space on a focused control presses that control; the arrows and numbers still work there.
  for (const target of [{ tag: 'BUTTON', role: null, editable: false }, { tag: 'DIV', role: 'button', editable: false }, { tag: 'A', role: null, editable: false }]) {
    assert.equal(playerShortcut(press(' ', { target })), null);
    assert.deepEqual(playerShortcut(press('ArrowRight', { target })), { action: 'next' });
    assert.deepEqual(playerShortcut(press('3', { target })), { action: 'choose', index: 2 });
  }
  // A held key repeats: never toggle back and forth, never choose twice.
  assert.equal(playerShortcut(press(' ', { repeat: true })), null);
  assert.equal(playerShortcut(press('1', { repeat: true })), null);
  assert.deepEqual(playerShortcut(press('ArrowRight', { repeat: true })), { action: 'next' }, 'holding an arrow keeps stepping');
});

// ---- Panels ---------------------------------------------------------------------------------------------------

const timeline: ComicTimeline = {
  panels: [
    { n: 1, startMs: 0, endMs: 4000, durationMs: 4000 },
    { n: 2, startMs: 4000, endMs: 9000, durationMs: 5000 },
    { n: 3, startMs: 9000, endMs: 12000, durationMs: 3000 },
  ],
  totalMs: 12000,
  narrated: false,
};

test('"previous panel" restarts the panel, or goes to the one before when it has only just started', () => {
  assert.equal(previousTarget(timeline, 0), 0);
  assert.equal(previousTarget(timeline, 3000), 0, 'well into panel 1: its start');
  assert.equal(previousTarget(timeline, 4000 + PREVIOUS_RESTARTS_MS - 1), 0, 'just into panel 2: panel 1');
  assert.equal(previousTarget(timeline, 4000 + PREVIOUS_RESTARTS_MS + 1), 4000, 'well into panel 2: its start');
  assert.equal(previousTarget(timeline, 9500), 4000);
  assert.equal(previousTarget(timeline, 12000), 9000, 'at the end: the last panel');
  assert.equal(previousTarget({ panels: [], totalMs: 0, narrated: false }, 500), 0);
});

test('a transcript row jumps to its panel; out-of-range numbers are clamped', () => {
  assert.deepEqual([0, 1, 2].map((i) => panelStartMs(timeline, i)), [0, 4000, 9000]);
  assert.equal(panelStartMs(timeline, -3), 0);
  assert.equal(panelStartMs(timeline, 7), 9000);
  assert.equal(panelStartMs(timeline, 1.7), 4000);
  assert.equal(panelStartMs({ panels: [], totalMs: 0, narrated: false }, 1), 0);
});

// ---- One rule for a tap, a key and a spoken choice -----------------------------------------------------------

const choice = (id: 'a' | 'b' | 'c', state: ChoiceView['state'], label = `Choice ${id}`): ChoiceView => ({
  id, label, hint: '', state, sceneId: state === 'ready' || state === 'working' ? `scene-${id}` : null, cost: state === 'new' || state === 'failed' ? 10 : 0,
});

test('choiceTakeable: blocked never; a new or failed path only while new scenes can be asked for', () => {
  assert.equal(choiceTakeable(choice('a', 'blocked'), false), false);
  assert.equal(choiceTakeable(choice('a', 'new'), false), true);
  assert.equal(choiceTakeable(choice('a', 'new'), true), false);
  assert.equal(choiceTakeable(choice('a', 'failed'), true), false);
  assert.equal(choiceTakeable(choice('a', 'ready'), true), true, 'a scene already made opens even when new ones are closed');
  assert.equal(choiceTakeable(choice('a', 'working'), true), true);
});

test('a spoken answer takes a choice the way a tap would, or says why not', () => {
  const choices = [
    choice('a', 'new', 'Write back'),
    choice('b', 'blocked', 'Climb the tower'),
    choice('c', 'ready', 'Ask the stranger'),
  ];
  const options = choices.map(({ id, label, hint }) => ({ id, label, hint }));
  const outcome = (text: string, closed = false) => voiceOutcome(matchVoiceChoice(text, options), choices, closed);

  const a = outcome('option A');
  assert.equal(a.kind, 'take');
  assert.equal(a.kind === 'take' && a.choice.id, 'a');
  assert.deepEqual(outcome('the second one'), { kind: 'unavailable', index: 1, choice: choices[1], reason: 'blocked' }, 'a path that cannot be drawn');
  assert.deepEqual(outcome('write back', true), { kind: 'unavailable', index: 0, choice: choices[0], reason: 'closed' }, 'new scenes are closed (no consent, story ended)');
  assert.equal(outcome('ask the stranger', true).kind, 'take', 'a scene already made still opens');
  assert.deepEqual(outcome('hmm, not sure'), { kind: 'unsure' });
  assert.deepEqual(outcome(''), { kind: 'unsure' });
  // A match for a choice that isn't on screen (a stale list) is never taken.
  assert.deepEqual(voiceOutcome({ kind: 'choice', index: 2, id: 'c', via: 'answer' }, choices.slice(0, 2), false), { kind: 'unsure' });
  assert.deepEqual(voiceOutcome({ kind: 'choice', index: 0, id: 'b', via: 'answer' }, choices, false), { kind: 'unsure' });
});

test('the seconds left while recording count down from 8 and never go below 0', () => {
  assert.equal(secondsLeft(0), 8);
  assert.equal(secondsLeft(-5), 8);
  assert.equal(secondsLeft(1), 8);
  assert.equal(secondsLeft(1000), 7);
  assert.equal(secondsLeft(7001), 1);
  assert.equal(secondsLeft(8000), 0);
  assert.equal(secondsLeft(9000), 0);
  assert.equal(secondsLeft(500, 3000), 3);
});

test('demo mode’s canned answer takes choice B in every demo scene that has choices', () => {
  for (const path of ['', 'a', 'b']) {
    const tpl = demoTemplate(path);
    assert.ok(tpl && tpl !== 'blocked' && tpl.choices.length === 3, path);
    const match = matchVoiceChoice(DEMO_VOICE_TRANSCRIPT, tpl.choices);
    assert.equal(match.kind === 'choice' && match.id, 'b', path || 'opening');
  }
});

// ---- Strings -----------------------------------------------------------------------------------------------

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

test('every key the voice step and the Create page build from a value exists', () => {
  const keys = [...VOICE_LOGIC_KEYS, ...['write', 'plan', 'scene', 'choose'].map((s) => `create:how.${s}`)];
  assert.deepEqual(keys.filter((k) => !resolves(k)), []);
  const create = read('features/story/screens/CreateScreen.tsx');
  assert.ok(create.includes("const HOW_STEPS = ['write', 'plan', 'scene', 'choose'] as const;"), 'HOW_STEPS list');
  assert.ok(create.includes('create:how.${step}'), 'the template is in the code');
});

test('the Meta models named to readers are the ones the server uses', () => {
  const how = (strings.create as { how: Record<string, string> }).how;
  const text = Object.values(how).join(' ');
  const named = [...text.matchAll(/\b(Muse [A-Z][a-z]+(?: [A-Z][a-z]+)?|SAM [\d.]+)/g)].map((m) => m[1]!);
  const server = readFileSync(fileURLToPath(new URL('../../../../server/src/ai/scene.ts', import.meta.url)), 'utf8')
    + readFileSync(fileURLToPath(new URL('../../../../server/src/ai/meta.ts', import.meta.url)), 'utf8');
  const ids: Record<string, string> = {
    'Muse Wonder': 'muse-wonder-1.0', 'Muse Image': 'muse-image-1.0', 'Muse Spark': 'muse-spark-1.3', 'SAM 3.1': 'sam-3.1',
    'Muse Voice Transcribe': 'muse-voice-transcribe-1.0',
  };
  assert.ok(named.length >= 5, named.join(', '));
  for (const name of named) {
    assert.ok(name in ids, `unknown model name ${name}`);
    assert.ok(server.includes(ids[name]!), `${name} is not used by the server`);
  }
});

// ---- Voice is web-only, and only the web file touches the microphone ---------------------------------------------

function files(path: string): string[] {
  const full = join(src, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

test('the native apps show no microphone and never load the recorder', () => {
  const native = read('features/story/components/VoiceChoice.tsx');
  assert.match(native, /export function VoiceChoice\(_props: VoiceChoiceProps\): null \{\s*return null;\s*\}/);
  const importers = files('features/story')
    .filter((f) => /\.tsx?$/.test(f) && /from '[^']*voice\/webRecorder'/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(src.length));
  assert.deepEqual(importers, ['features/story/components/VoiceChoice.web.tsx']);
  assert.ok(read('features/story/components/SceneChoices.tsx').includes('<VoiceChoice '), 'next to the choices');
});

test('nothing said is logged, and the recorder only reads the microphone', () => {
  for (const file of ['features/story/components/VoiceChoice.web.tsx', 'features/story/voice/webRecorder.ts', 'features/story/voiceHooks.ts', 'features/story/voiceLogic.ts']) {
    assert.doesNotMatch(read(file), /console\.|localStorage|sessionStorage|indexedDB/, file);
  }
  const recorder = read('features/story/voice/webRecorder.ts');
  assert.match(recorder, /getUserMedia\(\{\s*audio:/);
  assert.match(recorder, /video: false/);
});

test('the AudioWorklet is a same-origin file that only hands samples to the page', () => {
  const worklet = fileURLToPath(new URL('../../../public/voice/pcm-capture.js', import.meta.url));
  assert.ok(existsSync(worklet), 'apps/mobile/public/voice/pcm-capture.js');
  const code = readFileSync(worklet, 'utf8');
  const recorder = read('features/story/voice/webRecorder.ts');
  const name = /registerProcessor\('([^']+)'/.exec(code)?.[1];
  assert.ok(name && recorder.includes(`const WORKLET_NAME = '${name}';`), 'the recorder asks for the processor the file registers');
  assert.ok(recorder.includes("const WORKLET_URL = '/voice/pcm-capture.js';"), 'loaded from our own origin (script-src self)');
  assert.doesNotMatch(code, /fetch|importScripts|XMLHttpRequest|WebSocket|https?:/, 'no network from the worklet');
});

test('the player and the choices share the keyboard: the player steps, the choices choose', () => {
  const player = read('features/story/components/ComicPlayer.tsx');
  const choices = read('features/story/components/SceneChoices.tsx');
  assert.match(player, /useKeyboardShortcuts\(/);
  assert.match(choices, /useKeyboardShortcuts\(/);
  assert.match(choices, /shortcut\.action !== 'choose'/);
  assert.match(choices, /choiceTakeable\(c, newDisabled\)/, 'a key follows the same rule as a tap');
  const native = read('features/story/useKeyboardShortcuts.ts');
  assert.doesNotMatch(native, /document|addEventListener/, 'no key listeners in the native apps');
});
