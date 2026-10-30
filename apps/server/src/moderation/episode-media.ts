// First review of a creator's episode (its media and title together), run by the ingest workflow.
// Muse Spark sees evenly spaced frames, the episode and series text and, when it is ready in time, a
// transcript. "allow" approves, "block" rejects, "review" hands the episode to an editor. An "allow"
// that still names a category is treated as "review": a listed category is never waved through.

import { z } from 'zod';
import type { ContentPart, MetaClient } from '../ai/meta.ts';
import { episodeReviewPrompt, unfence } from '../ai/prompts.ts';

export const MEDIA_REVIEW_MODEL = 'muse-spark-1.3';

export const MEDIA_CATEGORIES = [
  'sexual_explicit', 'minor_sexualised', 'graphic_gore', 'hate', 'threat', 'self_harm', 'scam_spam', 'personal_data',
  'apparent_minor', 'mislabelled_mature', 'uncertain',
] as const;

export const MediaVerdictSchema = z.object({
  decision: z.enum(['allow', 'block', 'review']),
  categories: z.array(z.enum(MEDIA_CATEGORIES)).max(6),
  reason: z.string().max(200),
});
export type MediaVerdict = z.infer<typeof MediaVerdictSchema>;

export type Decision = 'approved' | 'rejected' | 'needs_editor';

export interface EpisodeReviewInput {
  title: string;
  series: { title: string; synopsis: string; maturity: 'general' | 'mature'; format: string };
  transcript: string | null;
}


/** The text the model judges, fenced. Only known fields, each labelled and capped. */
export function reviewText(input: EpisodeReviewInput): string {
  const lines = [
    `Episode title: ${unfence(input.title).slice(0, 80) || '(none)'}`,
    `Series title: ${unfence(input.series.title).slice(0, 80)}`,
    `Synopsis: ${unfence(input.series.synopsis).slice(0, 1000)}`,
    `Audience: ${input.series.maturity === 'mature' ? 'mature (18+ themes)' : 'general'}`,
    `Format: ${input.series.format === 'stop_motion' ? 'stop motion' : 'live action'}`,
  ];
  if (input.transcript) lines.push(`Transcript: ${unfence(input.transcript).slice(0, 3000)}`);
  return `<<<TEXT\n${lines.join('\n')}\nTEXT>>>`;
}

export function decide(v: MediaVerdict): Decision {
  if (v.decision === 'block') return 'rejected';
  if (v.decision === 'review' || v.categories.length > 0) return 'needs_editor';
  return 'approved';
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** One paid call: frames (JPEG) as data URLs, in time order, after the fenced text. */
export async function reviewEpisodeMedia(meta: MetaClient, input: EpisodeReviewInput, frames: Uint8Array[]): Promise<MediaVerdict> {
  const user: ContentPart[] = [
    { type: 'text', text: `${reviewText(input)}\nThe ${frames.length} frames follow in time order.` },
    ...frames.map((f) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${toBase64(f)}` } })),
  ];
  const { data } = await meta.chatJson({
    model: MEDIA_REVIEW_MODEL, schemaName: 'media_verdict', schema: MediaVerdictSchema, effort: 'medium',
    system: episodeReviewPrompt({ maturity: input.series.maturity, frames: frames.length, transcript: Boolean(input.transcript) }),
    user,
  });
  return data;
}
