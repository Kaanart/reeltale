// Automated first-pass moderation of text: new series, edits to approved series, episode title edits.
// Runs on the Worker's cron. Muse Spark decides: "allow" approves, "block" rejects, "review" hands the
// item to an editor. First reviews of episodes need their media and belong to the ingest workflow, so
// they are never approved here. Failures leave the item in the queue for the next run.

import { TextVerdictSchema, type TextVerdict } from '@reeltale/shared';
import { MetaApiError, type MetaClient } from '../ai/meta.ts';
import { textModerationPrompt } from '../ai/prompts.ts';

export const TEXT_TARGETS = ['series', 'series_edit', 'episode_edit'] as const;
type TextTarget = (typeof TEXT_TARGETS)[number];

export interface QueueItem {
  target: TextTarget;
  id: string;
  version: number;
  content: Record<string, unknown>;
}

export interface ReviewIO {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  meta: MetaClient;
  log(message: string): void;
}

export interface ReviewSummary {
  approved: number;
  rejected: number;
  held: number;
  failed: number;
}

const MODEL = 'muse-spark-1.3';

/** The text the model judges. Only known fields, each labelled, so nothing else slips in. */
export function reviewText(item: QueueItem): string {
  const c = item.content;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const lines: string[] = [];
  if (str(c.title)) lines.push(`Title: ${str(c.title)}`);
  if (str(c.synopsis)) lines.push(`Synopsis: ${str(c.synopsis)}`);
  const tags = Array.isArray(c.tag_slugs) ? c.tag_slugs.filter((t): t is string => typeof t === 'string') : [];
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  if (c.maturity === 'general' || c.maturity === 'mature') lines.push(`Audience: ${c.maturity === 'mature' ? 'mature (18+ themes)' : 'general'}`);
  return lines.join('\n').slice(0, 2500);
}

function decide(v: TextVerdict): 'approved' | 'rejected' | 'needs_editor' {
  return v.decision === 'allow' ? 'approved' : v.decision === 'block' ? 'rejected' : 'needs_editor';
}

export async function reviewBatch(io: ReviewIO, limit = 10): Promise<ReviewSummary> {
  const summary: ReviewSummary = { approved: 0, rejected: 0, held: 0, failed: 0 };
  const items = await io.rpc<QueueItem[]>('moderation_queue', { p_limit: limit, p_targets: [...TEXT_TARGETS], p_for_editor: false });
  for (const item of items ?? []) {
    if (!(TEXT_TARGETS as readonly string[]).includes(item.target)) continue;
    const text = reviewText(item);
    let decision: 'approved' | 'rejected' | 'needs_editor';
    let categories: string[] = [];
    let reason = '';
    if (!text) {
      decision = 'needs_editor';     // nothing to judge: a person should look
      reason = 'empty';
    } else {
      try {
        const { data } = await io.meta.chatJson({
          model: MODEL, schemaName: 'text_verdict', schema: TextVerdictSchema, effort: 'low',
          system: textModerationPrompt(item.target === 'episode_edit' ? 'title' : 'listing'),
          user: `<<<TEXT\n${text}\nTEXT>>>`,
        });
        decision = decide(data);
        categories = data.categories;
        reason = data.reason;
      } catch (e) {
        if (e instanceof MetaApiError && e.code === 'content_policy') {
          decision = 'needs_editor';  // the provider refused to read it: a person decides
          reason = 'provider_policy';
        } else {
          summary.failed++;
          io.log(`moderation ${item.target} ${item.id} failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`);
          continue;
        }
      }
    }
    const outcome = await io.rpc<string>('record_verdict', {
      p_target: item.target, p_id: item.id, p_version: item.version, p_source: 'auto', p_model: MODEL,
      p_decision: decision, p_categories: categories, p_reason: reason, p_editor: null,
    });
    if (outcome === 'held') summary.held++;
    else if (outcome === 'applied') summary[decision === 'approved' ? 'approved' : 'rejected']++;
  }
  return summary;
}
