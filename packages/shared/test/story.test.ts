import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCharacterAges, SceneScriptSchema, StoryArcSchema, StoryBibleSchema, StoryManifestSchema, toModelSchema,
  PanelCheckSchema, TextVerdictSchema,
} from '../src/index.ts';

const bible = {
  title: 'The Lighthouse Letters',
  logline: 'A keeper finds letters from someone who has not been born yet.',
  genre: 'Mystery',
  tone: 'Quiet, eerie, warm',
  setting: 'A storm-battered lighthouse on a northern island, 1987.',
  style_guide: 'Ink and watercolor, muted teal and amber, soft grain, cinematic framing, vertical 9:16.',
  characters: [{ id: 'mara', name: 'Mara', age: 34, role: 'Keeper', look: 'Freckles, auburn braid, grey eyes', outfit: 'Navy wool coat', voice: 'Low, dry' }],
  rules: ['Letters only appear at low tide.'],
  content_rating: 'general',
};

function scene(overrides: Record<string, unknown> = {}) {
  return {
    scene_title: 'Low Tide',
    narration: 'The tide pulled back and left an envelope on the rocks.',
    panels: [1, 2, 3, 4].map((n) => ({
      n, shot: 'medium', visual: 'Mara crouches on wet rocks reaching for an envelope.', focus_subject: 'the envelope',
      characters_present: ['mara'], caption: '', dialogue: [],
    })),
    choices: [
      { id: 'a', label: 'Open it now', hint: '' },
      { id: 'b', label: 'Take it to the lamp room', hint: '' },
      { id: 'c', label: 'Throw it back', hint: 'Not everything wants to be read.' },
    ],
    is_ending: false,
    continuity: { new_facts: ['The envelope is dry despite the sea.'], character_changes: [] },
    ...overrides,
  };
}

test('a well-formed bible and scene validate', () => {
  assert.ok(StoryBibleSchema.safeParse(bible).success);
  assert.ok(SceneScriptSchema.safeParse(scene()).success);
});

test('characters under 18 are rejected by the schema itself', () => {
  const r = StoryBibleSchema.safeParse({ ...bible, characters: [{ ...bible.characters[0], age: 16 }] });
  assert.equal(r.success, false);
});

test('romance stories require 21+', () => {
  const b = StoryBibleSchema.parse({ ...bible, characters: [{ ...bible.characters[0], age: 19 }] });
  assert.doesNotThrow(() => assertCharacterAges(b, ['mystery']));
  assert.throws(() => assertCharacterAges(b, ['romance']), /minimum is 21/);
  assert.throws(() => assertCharacterAges(b, ['enemies-to-lovers']), /minimum is 21/);
});

test('scenes need exactly 4 panels and 3 choices, and reject extra keys', () => {
  assert.equal(SceneScriptSchema.safeParse(scene({ choices: scene().choices.slice(0, 2) })).success, false);
  assert.equal(SceneScriptSchema.safeParse(scene({ panels: scene().panels.slice(0, 3) })).success, false);
  const extra = { ...scene(), secret: 'x' };
  // zod objects strip unknown keys on parse; the JSON Schema sent to the model forbids them.
  assert.equal('secret' in SceneScriptSchema.parse(extra), false);
});

test('model schemas are strict-mode ready and non-recursive', () => {
  for (const s of [StoryBibleSchema, StoryArcSchema, SceneScriptSchema, PanelCheckSchema, TextVerdictSchema]) {
    const js = toModelSchema(s);
    assert.equal(js.type, 'object');
    assert.equal('$schema' in js, false);
    const walk = (node: unknown, depth: number): void => {
      assert.ok(depth <= 10, 'nesting depth ≤ 10');
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      assert.equal('oneOf' in o, false);
      assert.equal('allOf' in o, false);
      assert.equal('$ref' in o, false);
      if (o.type === 'object') {
        assert.equal(o.additionalProperties, false);
        const props = Object.keys((o.properties as object) ?? {});
        assert.deepEqual([...(o.required as string[])].sort(), props.sort());
      }
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
        else walk(v, depth + 1);
      }
    };
    walk(js, 0);
  }
});

test('the manifest requires AI provenance', () => {
  const m = {
    version: 1, story_id: crypto.randomUUID(), scene_id: crypto.randomUUID(), title: 'Low Tide',
    panels: [1, 2, 3, 4].map((n) => ({ n, image: `ai/s/${n}.webp`, plate: null, focus: { x: 0.2, y: 0.3, w: 0.4, h: 0.3 }, caption: '', dialogue: [] })),
    narration: { text: 'x', audio: null, captions_vtt: null, duration_ms: null },
    choices: scene().choices, is_ending: false,
    provenance: { ai_generated: true, prompt_version: '2026-10-27.1', created_at: new Date().toISOString(), models: [{ task: 'script', provider: 'meta', model: 'muse-spark-1.3' }], c2pa_signed: false },
  };
  assert.ok(StoryManifestSchema.safeParse(m).success);
  assert.equal(StoryManifestSchema.safeParse({ ...m, provenance: { ...m.provenance, ai_generated: false } }).success, false);
});
