// The hosted legal pages (generated from prep/legal on the studio site) and where each one is listed in
// Settings. Only these fixed addresses are ever opened from the app.

export const LEGAL_BASE = 'https://eurastudios.com/apps/reeltale/';

export const LEGAL_PAGES = ['terms', 'privacy', 'community', 'ai-policy', 'coins-refunds'] as const;
export type LegalPageSlug = (typeof LEGAL_PAGES)[number];

export function legalUrl(slug: LegalPageSlug): string {
  return `${LEGAL_BASE}${slug}/`;
}

/** The Settings label of each page. */
export const LEGAL_LABEL_KEYS: Record<LegalPageSlug, string> = {
  terms: 'settings:legal.terms',
  privacy: 'settings:legal.privacy',
  community: 'settings:legal.community',
  'ai-policy': 'settings:legal.aiPolicy',
  'coins-refunds': 'settings:legal.coins',
};
