// Per-purpose AI consent (public.ai_consents, set through public.set_ai_consent). One row per purpose;
// withdrawing is as easy as giving (GDPR Art. 7(3)), so Settings has one switch per purpose.
//
// `providers` names who receives the data. The database fails closed: story AI needs 'meta' in the list,
// and so does upload processing (has_ai_consent). The text next to each switch (settings:aiConsents.*)
// names the same providers, so change both together.

export type AiConsentPurpose = 'story' | 'upload_processing' | 'voice';

/** The version of the AI policy the wording refers to (prep/legal/ai-content-policy-draft.md, "Last updated"). */
export const AI_CONSENT_VERSION = '2026-10-22';

export interface ConsentPurposeInfo {
  purpose: AiConsentPurpose;
  providers: readonly string[];
  /** The i18n group under settings:aiConsents. */
  textKey: 'story' | 'upload' | 'voice';
}

export const AI_CONSENT_PURPOSES: readonly ConsentPurposeInfo[] = [
  { purpose: 'story', providers: ['meta', 'google'], textKey: 'story' },
  { purpose: 'upload_processing', providers: ['meta'], textKey: 'upload' },
  { purpose: 'voice', providers: ['meta'], textKey: 'voice' },
];

export interface ConsentRow {
  purpose: AiConsentPurpose;
  providers: string[];
  version: string;
  accepted_at: string;
  withdrawn_at: string | null;
}

/** Granted columns of public.ai_consents (the user id is left out: RLS already limits the rows to the owner). */
export const CONSENT_COLUMNS = 'purpose, providers, version, accepted_at, withdrawn_at';

function isPurpose(value: unknown): value is AiConsentPurpose {
  return value === 'story' || value === 'upload_processing' || value === 'voice';
}

/** `unknown` in, rows out; null when it isn't a list. A row of the wrong shape is dropped, never half-shown. */
export function parseConsents(raw: unknown): ConsentRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: ConsentRow[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!isPurpose(r.purpose) || !Array.isArray(r.providers) || typeof r.version !== 'string') continue;
    rows.push({
      purpose: r.purpose,
      providers: (r.providers as unknown[]).filter((p): p is string => typeof p === 'string'),
      version: r.version,
      accepted_at: typeof r.accepted_at === 'string' ? r.accepted_at : '',
      withdrawn_at: typeof r.withdrawn_at === 'string' ? r.withdrawn_at : null,
    });
  }
  return rows;
}

/** On while there is a row that hasn't been withdrawn. */
export function consentOn(rows: readonly ConsentRow[] | undefined, purpose: AiConsentPurpose): boolean {
  return !!rows?.some((r) => r.purpose === purpose && r.withdrawn_at === null);
}

export interface SetConsentArgs {
  p_purpose: AiConsentPurpose;
  p_providers: string[];
  p_version: string;
  p_granted: boolean;
}

/**
 * The arguments of public.set_ai_consent. Giving consent records the providers and version shown next to the
 * switch. Withdrawing keeps what was recorded (the function only stamps withdrawn_at).
 */
export function consentArgs(
  purpose: AiConsentPurpose,
  granted: boolean,
  existing?: ConsentRow,
): SetConsentArgs {
  const info = AI_CONSENT_PURPOSES.find((p) => p.purpose === purpose);
  const providers = granted ? [...(info?.providers ?? [])] : [...(existing?.providers ?? info?.providers ?? [])];
  return {
    p_purpose: purpose,
    p_providers: providers,
    p_version: granted ? AI_CONSENT_VERSION : (existing?.version ?? AI_CONSENT_VERSION),
    p_granted: granted,
  };
}
