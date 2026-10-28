// Share-link previews: crawlers (and people) hitting reeltale.net/series/<slug> get the normal web
// app, with OpenGraph tags for that series added to <head>. Values come from the database but are
// user-written (titles, synopses), so they are escaped strictly and length-capped before they touch
// HTML. Only published, approved, non-mature series get a card.

export interface ShareCard {
  title: string;
  description: string;
  image: string | null;
  url: string;
}

const MAX_TITLE = 90;
const MAX_DESC = 200;

/** Escape for an HTML attribute value inside double quotes. Strips control characters. */
export function escapeAttr(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** The <meta> tags to append to <head>. Every value passes through escapeAttr. */
export function ogTags(card: ShareCard): string {
  const title = escapeAttr(clip(card.title, MAX_TITLE));
  const desc = escapeAttr(clip(card.description, MAX_DESC));
  const url = escapeAttr(card.url);
  const tags = [
    `<meta property="og:type" content="video.tv_show">`,
    `<meta property="og:site_name" content="ReelTale">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta name="twitter:card" content="${card.image ? 'summary_large_image' : 'summary'}">`,
  ];
  if (card.image) tags.push(`<meta property="og:image" content="${escapeAttr(card.image)}">`);
  return tags.join('');
}

/** Only accept image URLs on our own media origin (no attacker-chosen hosts in previews). */
export function safeImageUrl(key: string | null | undefined, mediaOrigin: string): string | null {
  if (!key || !/^public\/covers\/[A-Za-z0-9/_.-]{1,200}$/.test(key) || key.includes('..')) return null;
  return `${mediaOrigin}/${key}`;
}
