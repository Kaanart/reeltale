// Day formatting for the Me screens ("12 Nov 2026"), kept apart so node can test it.

export type Locales = string | readonly string[] | undefined;

/** A date as a short day ("12 Nov 2026"), or '' when it can't be read. */
export function formatDay(value: string | Date, locale?: Locales): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale as string | string[] | undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
}

/** Same calendar day in the viewer's time zone. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
