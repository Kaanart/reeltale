// Reporting content and people (public.report_content, supabase/migrations/20261028090100_trust.sql).
//
// The reason list and the target types are the database's own (app_private.check_report): a value that is
// not in the list is refused there, so the list below must stay in step with that function.

export const REPORT_TARGET_TYPES = ['series', 'episode', 'ai_scene', 'profile'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** Most urgent first; `other` last. */
export const REPORT_REASONS = [
  'minor_safety', 'sexual_content', 'impersonation', 'hate_harassment', 'violence', 'self_harm',
  'copyright', 'ai_not_labelled', 'spam_scam', 'illegal_other', 'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * The i18n key of a reason's label. `illegal_other` is stored under `illegal`: a key ending in `_other` reads as
 * the plural form of another string to i18next.
 */
export function reasonLabelKey(reason: ReportReason): string {
  return `report:reasons.${reason === 'illegal_other' ? 'illegal' : reason}`;
}

/** report_content refuses details over 2000 characters (the check counts code points; this counts UTF-16 units, so it is never looser). */
export const DETAILS_MAX = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === 'string' && (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

/** Reasons that make sense for what is being reported: a profile can't be "AI that isn't labelled". */
export function reasonsFor(type: ReportTargetType): ReportReason[] {
  return REPORT_REASONS.filter((r) => !(type === 'profile' && r === 'ai_not_labelled'));
}

export interface ReportTarget {
  type: ReportTargetType;
  /** Lower-case UUID of the series, episode, AI scene or profile. */
  id: string;
  /**
   * The `creator` param of the link (series pages add it). Never used to choose whom to block: a link can
   * name anyone, so the block offer uses the owner the database gives for the content (blockableUser).
   */
  creatorId: string | null;
}

type Param = string | string[] | undefined;

function first(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The route is /report?type=series|episode|ai_scene|profile&id=<uuid>[&creator=<uuid>]. Anything else gives
 * null (the screen then says it can't find what is being reported). The ids name the thing reported and the
 * person to block: they are never the signed-in user's identity, which only ever comes from the session.
 */
export function parseReportParams(params: { type?: Param; id?: Param; creator?: Param }): ReportTarget | null {
  const type = first(params.type);
  const id = first(params.id)?.trim();
  if (!isReportTargetType(type) || !id || !UUID.test(id)) return null;
  const creator = first(params.creator)?.trim();
  return { type, id: id.toLowerCase(), creatorId: creator && UUID.test(creator) ? creator.toLowerCase() : null };
}

/** The route for a report, for any screen that offers "Report". */
export function reportHref(type: ReportTargetType, id: string, creatorId?: string | null) {
  return {
    pathname: '/report' as const,
    params: { type, id, ...(creatorId ? { creator: creatorId } : {}) },
  };
}

/** A lower-case UUID, or null for anything else (a database answer is read defensively). */
export function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Whom the confirmation can offer to block: the reported profile itself, or `owner`, the creator of the
 * reported series or episode as the database names it (useContentOwner in hooks.ts). Never yourself, and
 * never the link's `creator` param: a crafted link could otherwise get someone to block a person who had
 * nothing to do with what they reported.
 */
export function blockableUser(target: ReportTarget, selfId: string | null, owner: string | null = null): string | null {
  const who = target.type === 'profile' ? target.id : uuidOrNull(owner);
  if (!who || who === selfId?.toLowerCase()) return null;
  return who;
}

/** The block offer's label: a reported profile is a person (maybe no creator at all); content has a creator. */
export function blockOfferKey(type: ReportTargetType): string {
  return type === 'profile' ? 'report:alsoBlockProfile' : 'report:alsoBlock';
}

export type ReportProblem = 'need_reason' | 'need_good_faith';

export function checkReport(input: { reason: ReportReason | null; goodFaith: boolean }): ReportProblem | null {
  if (!input.reason) return 'need_reason';
  if (!input.goodFaith) return 'need_good_faith';
  return null;
}

/** Trimmed details, or null when there is nothing to send. */
export function cleanDetails(text: string): string | null {
  const t = text.trim();
  return t.length === 0 ? null : t.slice(0, DETAILS_MAX);
}

export interface ReportArgs {
  p_target_type: ReportTargetType;
  p_target_id: string;
  p_reason: ReportReason;
  p_details: string | null;
}

export function reportArgs(target: ReportTarget, reason: ReportReason, details: string): ReportArgs {
  return { p_target_type: target.type, p_target_id: target.id, p_reason: reason, p_details: cleanDetails(details) };
}
