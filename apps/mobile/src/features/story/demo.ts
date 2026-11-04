// Demo-mode fixtures for AI stories: a small branching tree of finished scenes that every demo story
// plays, drawn with the four bundled panel pictures (src/demo/assets, mapped by demoPanelImage). Pure data:
// node checks every manifest against StoryManifestSchema in src/core/__tests__/story-demo.test.ts.
//
//   ''          "The Bottle" (the shared fixture scene, src/demo/fixtures.ts)
//   'a', 'b'    the next scene for choices a and b, each with three choices of its own
//   'c'         a path that "couldn't be drawn safely": it ends blocked, to show that flow
//   'xa'..'xc'  three endings, one per last choice (no choices, is_ending)

import { PROMPT_VERSION, type Choice, type StoryManifest } from '@reeltale/shared';
import {
  DEMO_PANEL_KEYS, DEMO_SCENE_ID, DEMO_STORY_ID, demoAiScene, demoAiStory, demoManifest,
} from '../../demo/fixtures.ts';
import type { AiSceneRow } from '../../lib/types.ts';

type ManifestPanel = StoryManifest['panels'][number];
type Dialogue = ManifestPanel['dialogue'];

export interface DemoSceneTemplate {
  title: string;
  narration: string;
  /** Four panels in play order: which bundled picture (0-3), its caption and dialogue. */
  panels: readonly { image: number; caption: string; dialogue: Dialogue }[];
  choices: readonly Choice[];
  isEnding: boolean;
}

const ROOT: DemoSceneTemplate = {
  title: demoManifest.title,
  narration: demoManifest.narration.text,
  panels: demoManifest.panels.map((p, i) => ({ image: i, caption: p.caption, dialogue: p.dialogue })),
  choices: demoManifest.choices,
  isEnding: false,
};

const SCENES: Record<'a' | 'b', DemoSceneTemplate> = {
  a: {
    title: 'The Letter',
    narration: 'Mara broke the seal with her thumb. The letter was dated tomorrow, and it asked her for one thing only.',
    panels: [
      { image: 3, caption: 'The wax cracked like thin ice.', dialogue: [] },
      { image: 0, caption: 'One page, in her own careful hand.', dialogue: [{ name: 'Mara', line: '“Don’t light the lamp tonight.”' }] },
      { image: 2, caption: 'Out on the sand, the stranger was waiting.', dialogue: [{ name: 'Stranger', line: 'Now you know why I came.' }] },
      { image: 1, caption: 'Behind her, the lamp flickered on by itself.', dialogue: [{ name: 'Mara', line: 'Who lit that?' }] },
    ],
    choices: [
      { id: 'a', label: 'Write back', hint: 'Answer your own letter' },
      { id: 'b', label: 'Climb the tower', hint: 'Find out who lit the lamp' },
      { id: 'c', label: 'Ask the stranger', hint: 'What does he know?' },
    ],
    isEnding: false,
  },
  b: {
    title: 'Footprints',
    narration: 'The sand held his footprints and hers, side by side, as if they had walked this way before.',
    panels: [
      { image: 2, caption: 'The stranger walked out where the sea should be.', dialogue: [] },
      { image: 1, caption: 'Mara followed his footprints across the wet sand.', dialogue: [{ name: 'Mara', line: 'Wait! Where are we going?' }] },
      { image: 0, caption: 'Far out, a door stood alone in the shallows.', dialogue: [{ name: 'Stranger', line: 'Where you went last time.' }] },
      { image: 3, caption: 'Its brass handle was still warm.', dialogue: [{ name: 'Mara', line: 'I’ve never been here before.' }] },
    ],
    choices: [
      { id: 'a', label: 'Open the door', hint: 'Step through' },
      { id: 'b', label: 'Knock first', hint: 'Someone might answer' },
      { id: 'c', label: 'Turn back', hint: 'Before the tide returns' },
    ],
    isEnding: false,
  },
};

const ENDINGS: Record<'a' | 'b' | 'c', DemoSceneTemplate> = {
  a: {
    title: 'Full Circle',
    narration: 'Some letters are answered before they are sent. Mara’s was one of them.',
    panels: [
      { image: 1, caption: 'She wrote by lamplight until the ink ran out.', dialogue: [] },
      { image: 3, caption: 'She sealed the bottle with the same red wax.', dialogue: [{ name: 'Mara', line: 'There. Now it’s your turn.' }] },
      { image: 0, caption: 'The tide came in and took it gently.', dialogue: [] },
      { image: 2, caption: 'At dawn the beach was empty, and the lamp burned steady.', dialogue: [{ name: 'Mara', line: 'See you yesterday.' }] },
    ],
    choices: [],
    isEnding: true,
  },
  b: {
    title: 'The Lamp Room',
    narration: 'At the top of the tower someone had left a chair, a cold cup of tea, and a logbook open at tonight’s date.',
    panels: [
      { image: 0, caption: 'Ninety-two steps. She counted every one.', dialogue: [] },
      { image: 2, caption: 'The logbook was in her handwriting too.', dialogue: [{ name: 'Mara', line: 'So it was me all along.' }] },
      { image: 3, caption: 'She turned the lamp toward the sea.', dialogue: [] },
      { image: 1, caption: 'Far out, a small light answered.', dialogue: [{ name: 'Stranger', line: 'Right on time, keeper.' }] },
    ],
    choices: [],
    isEnding: true,
  },
  c: {
    title: 'High Tide',
    narration: 'The sea came back all at once, the way it always does, and took the strange night with it.',
    panels: [
      { image: 2, caption: 'The water rose around their ankles.', dialogue: [{ name: 'Stranger', line: 'Same time next year?' }] },
      { image: 1, caption: 'Then he was gone, and so were his footprints.', dialogue: [] },
      { image: 3, caption: 'Only the bottle was left, empty now.', dialogue: [{ name: 'Mara', line: 'Next year, then.' }] },
      { image: 0, caption: 'Mara walked home as the tide came in.', dialogue: [] },
    ],
    choices: [],
    isEnding: true,
  },
};

/** The choice at the first scene that ends blocked in the demo. */
export const DEMO_BLOCKED_PATH = 'c';

/**
 * Demo mode's "Say your choice": the microphone records on the device only, nothing is sent, and this comes back
 * as the transcript. It names choice b, which every demo scene with choices can take.
 */
export const DEMO_VOICE_TRANSCRIPT = 'The second one, please.';

/**
 * The scene a path of choices leads to ('' is the opening, 'ab' is choice a then b), 'blocked' for the
 * path that can't be drawn, or null when there is no scene (past an ending).
 */
export function demoTemplate(path: string): DemoSceneTemplate | 'blocked' | null {
  if (!/^[abc]{0,2}$/.test(path)) return null;
  if (path === '') return ROOT;
  if (path === DEMO_BLOCKED_PATH) return 'blocked';
  if (path === 'a' || path === 'b') return SCENES[path];
  if (path.startsWith(DEMO_BLOCKED_PATH)) return null;
  return ENDINGS[path[1] as 'a' | 'b' | 'c'];
}

/** The models a demo scene names in "How this scene was made", like the real pipeline (scene-runner.ts). */
function demoModels(kind: 'story_start' | 'scene'): StoryManifest['provenance']['models'] {
  return [
    ...(kind === 'story_start'
      ? [{ task: 'plan', provider: 'meta', model: 'muse-wonder-1.0' }, { task: 'sheets', provider: 'meta', model: 'muse-image-1.0' }]
      : []),
    { task: 'script', provider: 'meta', model: 'muse-spark-1.3' },
    { task: 'panels', provider: 'meta', model: 'muse-image-1.0' },
    { task: 'check', provider: 'meta', model: 'muse-spark-1.3' },
    { task: 'focus', provider: 'meta', model: 'sam-3.1' },
  ];
}

/** The manifest of a demo scene, for the story and scene ids it was made under. Null for a path with no picture. */
export function buildDemoManifest(
  storyId: string, sceneId: string, path: string, createdAt: string,
): StoryManifest | null {
  const tpl = demoTemplate(path);
  if (!tpl || tpl === 'blocked') return null;
  return {
    version: 1,
    story_id: storyId,
    scene_id: sceneId,
    title: tpl.title,
    panels: tpl.panels.map((p, i): ManifestPanel => ({
      n: i + 1,
      image: DEMO_PANEL_KEYS[p.image] ?? DEMO_PANEL_KEYS[0]!,
      plate: null,
      // The subject box belongs to the picture, so it comes with it.
      focus: demoManifest.panels[p.image]?.focus ?? null,
      caption: p.caption,
      dialogue: p.dialogue,
    })),
    narration: { text: tpl.narration, audio: null, captions_vtt: null, duration_ms: null },
    choices: [...tpl.choices],
    is_ending: tpl.isEnding,
    provenance: {
      ai_generated: true,
      prompt_version: PROMPT_VERSION,
      created_at: createdAt,
      models: demoModels(path === '' ? 'story_start' : 'scene'),
      c2pa_signed: false,
    },
  };
}

// ---- The fixture story: already started, with one path read and one path blocked -----------------------

/** Fixed, valid v4-shaped UUIDs, like src/demo/fixtures.ts. */
const id = (prefix: string, n: number) => `${prefix.padEnd(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const DEMO_SCENE_A_ID = id('a2', 2);
export const DEMO_SCENE_C_ID = id('a2', 3);

/** The scenes of the fixture story ("Low Tide"): the opening, choice a (drawn) and choice c (blocked). */
export const demoFixtureScenes: readonly { row: AiSceneRow; path: string }[] = [
  { row: demoAiScene, path: '' },
  {
    row: {
      id: DEMO_SCENE_A_ID, story_id: DEMO_STORY_ID, parent_scene_id: DEMO_SCENE_ID, chosen_choice: 'a', depth: 2,
      status: 'ready', title: SCENES.a.title, is_ending: false, created_at: '2026-10-29T08:20:00Z',
    },
    path: 'a',
  },
  {
    row: {
      id: DEMO_SCENE_C_ID, story_id: DEMO_STORY_ID, parent_scene_id: DEMO_SCENE_ID, chosen_choice: 'c', depth: 2,
      status: 'blocked', title: null, is_ending: false, created_at: '2026-10-29T08:25:00Z',
    },
    path: 'c',
  },
];

export { demoAiStory, DEMO_SCENE_ID, DEMO_STORY_ID };
