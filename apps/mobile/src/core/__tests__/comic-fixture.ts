// A valid StoryManifest for the tests (checked against the real schema, so a bad fixture fails loudly).
import { StoryManifestSchema, type FocusBox, type StoryManifest } from '@reeltale/shared';

export const STORY_ID = '11111111-1111-4111-8111-111111111111';
export const SCENE_ID = '22222222-2222-4222-8222-222222222222';

export interface PanelSpec {
  caption?: string;
  dialogue?: string[];
  focus?: FocusBox | null;
}

/** `n` one-letter words: "a a a" (short, so up to 70 of them fit the schema's 140-character limit). */
export const words = (n: number): string => Array.from({ length: n }, () => 'a').join(' ');

export function makeManifest(
  panels: PanelSpec[] = [{}, {}, {}, {}],
  extra: { narration?: Partial<StoryManifest['narration']>; is_ending?: boolean; choices?: StoryManifest['choices'] } = {},
): StoryManifest {
  const list = [...panels];
  while (list.length < 4) list.push({});
  return StoryManifestSchema.parse({
    version: 1,
    story_id: STORY_ID,
    scene_id: SCENE_ID,
    title: 'Low Tide',
    panels: list.slice(0, 4).map((p, i) => ({
      n: i + 1,
      image: `ai/${STORY_ID}/${SCENE_ID}/panel-${i + 1}.webp`,
      plate: null,
      focus: p.focus ?? null,
      caption: p.caption ?? '',
      dialogue: (p.dialogue ?? []).map((line) => ({ name: 'Mara', line })),
    })),
    narration: { text: 'The tide pulled back.', audio: null, captions_vtt: null, duration_ms: null, ...extra.narration },
    choices: extra.choices ?? [
      { id: 'a', label: 'Open it', hint: '' },
      { id: 'b', label: 'Leave it', hint: '' },
      { id: 'c', label: 'Burn it', hint: '' },
    ],
    is_ending: extra.is_ending ?? false,
    provenance: {
      ai_generated: true, prompt_version: '2026-10-27.1', created_at: '2026-10-28T10:00:00Z',
      models: [{ task: 'panels', provider: 'meta', model: 'muse-image-1.0' }], c2pa_signed: false,
    },
  });
}
