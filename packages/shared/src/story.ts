// AI story data: what the models must return (validated with zod and sent to Meta as JSON Schema for
// structured output), and the manifest the app plays. One source of truth for both sides.
//
// Rules carried in the schema itself, not just in prompts:
// - every character is an adult (age 18+, 21+ when the story is romance-tagged; checked in code),
// - the branch structure is a flat list (Meta rejects recursive schemas),
// - every object is closed (strict mode: additionalProperties false, all keys required).

import { z } from 'zod';

export const PROMPT_VERSION = '2026-10-27.1';

const id = z.string().regex(/^[a-z0-9_-]{1,24}$/);
const text = (max: number) => z.string().min(1).max(max);

export const CharacterSchema = z.object({
  id,
  name: text(40),
  age: z.number().int().min(18).max(120),
  role: text(60),
  look: text(300),        // face, hair, build: used verbatim in every panel prompt
  outfit: text(200),
  voice: text(80),
});
export type Character = z.infer<typeof CharacterSchema>;

export const StoryBibleSchema = z.object({
  title: text(80),
  logline: text(200),
  genre: text(40),
  tone: text(80),
  setting: text(300),
  style_guide: text(300), // visual style appended to every panel prompt
  characters: z.array(CharacterSchema).min(1).max(4),
  rules: z.array(text(160)).max(6), // world rules that must stay consistent
  content_rating: z.enum(['general', 'mature']),
});
export type StoryBible = z.infer<typeof StoryBibleSchema>;

// Muse Wonder's plan for the whole story: a flat list of planned beats with parent links.
export const StoryArcSchema = z.object({
  premise_summary: text(300),
  ending_options: z.array(text(200)).min(2).max(3),
  beats: z.array(z.object({
    id,
    parent_id: id.nullable(),
    summary: text(240),
    tension: z.number().int().min(1).max(5),
  })).min(3).max(24),
});
export type StoryArc = z.infer<typeof StoryArcSchema>;

export const PanelSchema = z.object({
  n: z.number().int().min(1).max(4),
  shot: z.enum(['wide', 'medium', 'close', 'extreme_close']),
  visual: text(600),        // what the image shows; no text in the image
  focus_subject: text(40),  // short noun phrase for SAM 3.1 ("the courier", "red door")
  characters_present: z.array(id).max(4),
  caption: z.string().max(140),
  dialogue: z.array(z.object({ character_id: id, line: text(140) })).max(2),
});
export type Panel = z.infer<typeof PanelSchema>;

export const ChoiceSchema = z.object({
  id: z.enum(['a', 'b', 'c']),
  label: text(60),
  hint: z.string().max(100),
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const SceneScriptSchema = z.object({
  scene_title: text(60),
  narration: text(700),
  panels: z.array(PanelSchema).length(4),
  choices: z.array(ChoiceSchema).length(3),
  is_ending: z.boolean(),
  continuity: z.object({
    new_facts: z.array(text(160)).max(5),
    character_changes: z.array(z.object({ character_id: id, change: text(160) })).max(4),
  }),
});
export type SceneScript = z.infer<typeof SceneScriptSchema>;

export const POLICY_CATEGORIES = [
  'apparent_minor', 'sexual', 'real_person', 'graphic_violence', 'hate', 'self_harm', 'copyrighted_character',
  'consistency', 'quality',
] as const;

// Muse Spark's vision check of a scene's four panels.
export const PanelCheckSchema = z.object({
  issues: z.array(z.object({
    panel: z.number().int().min(1).max(4),
    category: z.enum(POLICY_CATEGORIES),
    severity: z.enum(['block', 'regenerate', 'note']),
    detail: z.string().max(200),
  })).max(12),
});
export type PanelCheck = z.infer<typeof PanelCheckSchema>;

// Text moderation (story openings, typed choices, comments, bios, handles).
export const TextVerdictSchema = z.object({
  decision: z.enum(['allow', 'block', 'review']),
  categories: z.array(z.enum([...POLICY_CATEGORIES, 'spam', 'personal_data', 'harassment'])).max(6),
  reason: z.string().max(200),
});
export type TextVerdict = z.infer<typeof TextVerdictSchema>;

/** Characters in romance-tagged stories must be 21+ (stricter than the 18+ floor in the schema). */
export function assertCharacterAges(bible: StoryBible, tags: readonly string[]): void {
  const romance = tags.some((t) => /romance|lovers|marriage|mates|love/.test(t));
  const min = romance ? 21 : 18;
  for (const c of bible.characters) {
    if (c.age < min) throw new Error(`character ${c.id} is ${c.age}; minimum is ${min}`);
  }
}

// ---- What the app plays -------------------------------------------------------------------------

export const FocusBoxSchema = z.object({
  // Normalized to 0..1 of the image size.
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type FocusBox = z.infer<typeof FocusBoxSchema>;

export const ManifestPanelSchema = z.object({
  n: z.number().int().min(1).max(4),
  image: z.string().min(1),          // asset key or URL resolved by the app
  plate: z.string().nullable(),      // clean background plate for parallax (may be missing)
  focus: FocusBoxSchema.nullable(),  // SAM box of the focus subject
  caption: z.string().max(140),
  dialogue: z.array(z.object({ name: z.string().max(40), line: z.string().max(140) })).max(2),
});

export const StoryManifestSchema = z.object({
  version: z.literal(1),
  story_id: z.string().uuid(),
  scene_id: z.string().uuid(),
  title: z.string().max(60),
  panels: z.array(ManifestPanelSchema).length(4),
  narration: z.object({
    text: z.string().max(700),
    audio: z.string().nullable(),
    captions_vtt: z.string().nullable(),
    duration_ms: z.number().int().min(0).nullable(),
  }),
  choices: z.array(ChoiceSchema).max(3),
  is_ending: z.boolean(),
  provenance: z.object({
    ai_generated: z.literal(true),
    prompt_version: z.string(),
    created_at: z.string(),
    models: z.array(z.object({ task: z.string(), provider: z.string(), model: z.string() })).min(1),
    c2pa_signed: z.boolean(),
  }),
});
export type StoryManifest = z.infer<typeof StoryManifestSchema>;

/** JSON Schema for Meta's structured output, without the $schema marker. */
export function toModelSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}
