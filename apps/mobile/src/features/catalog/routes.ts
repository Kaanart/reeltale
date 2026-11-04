// Where the catalog's screens send people. Routes owned by other tracks (watch, story, me) are only named here,
// in one place, so a rename is a one-line change. Typed routes only know a route once its file exists, hence
// the casts.

import type { Href } from 'expo-router';
import type { Ranking } from './logic';

type Params = Record<string, string>;
const href = (pathname: string, params?: Params): Href => (params ? { pathname, params } : pathname) as Href;

export const routes = {
  home: href('/'),
  series: (slug: string) => href('/series/[slug]', { slug }),
  /** Owned by the watch track. */
  watch: (episodeId: string) => href('/watch/[episodeId]', { episodeId }),
  /** Owned by the story track: the AI story flow. */
  storyNew: href('/story/new'),
  /** Owned by the me track: /report?type=series&id=…, with the creator so the report can offer to block them. */
  reportSeries: (seriesId: string, creatorId?: string | null) =>
    href('/report', creatorId ? { type: 'series', id: seriesId, creator: creatorId } : { type: 'series', id: seriesId }),
  /** Owned by the me track. */
  settings: href('/settings'),
  /**
   * The Discover tab, optionally on one ranking or one tag. `n` changes with every call, so asking for the same
   * ranking twice still counts as a new request after the reader changed the chips in between.
   */
  discover: (options: DiscoverOptions = {}) => href('/discover', discoverParams(options)),
  /** The same address as a string, for a web link's href (what the browser shows and opens in a new tab). */
  discoverUrl: (options: DiscoverOptions = {}) => {
    const query = Object.entries(discoverParams(options))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return `/discover?${query}`;
  },
} as const;

export interface DiscoverOptions {
  ranking?: Ranking;
  tagId?: number;
}

function discoverParams(options: DiscoverOptions): Params {
  const params: Params = { n: Date.now().toString(36) };
  if (options.ranking) params.ranking = options.ranking;
  if (options.tagId !== undefined) params.tag = String(options.tagId);
  return params;
}
