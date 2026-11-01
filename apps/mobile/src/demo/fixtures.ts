// Demo-mode data: what the app shows with EXPO_PUBLIC_DEMO=1 (or no Supabase), with no network at all.
// Rows have exactly the shapes of src/lib/types.ts (the granted columns), so a feature hook returns them
// where it would return a Supabase result. Pure data (no React Native, no images): node checks it against
// the shared schemas and the catalog rules in src/core/__tests__/demo-fixtures.test.ts. Images are mapped
// in ./images.ts.
//
// Feature tracks extend this in their own folders (src/features/<track>/demo.ts), importing from here;
// change this file only to fix a shared fixture.

import { PROMPT_VERSION, type StoryManifest, type Wallet } from '@reeltale/shared';
import { TERMS_VERSION, type Role } from '../lib/gate.ts';
import type {
  AccountRow, AiSceneRow, AiStoryRow, EpisodeRow, ProfileRow, SeriesFormat, SeriesRow, TagRow,
} from '../lib/types.ts';

/** Fixed, valid v4-shaped UUIDs: `id('5e', 3)` -> 5e000000-0000-4000-8000-000000000003. */
const id = (prefix: string, n: number) => `${prefix.padEnd(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const DAY_MS = 86_400_000;
const PUBLISHED = '2026-10-01T09:00:00Z';

// ---- The demo account ------------------------------------------------------------------------------

export const DEMO_USER_ID = id('de', 1);
export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_ROLE: Role = 'user';

export const demoProfile: ProfileRow = {
  id: DEMO_USER_ID, handle: 'demo_reader', display_name: 'Demo Reader', bio: null, avatar_key: null,
};

/** profile_private of an adult who has accepted the current Terms. */
export const demoAccount: AccountRow = {
  user_id: DEMO_USER_ID,
  age_status: 'adult',
  country: 'DE',
  locale: 'en',
  mature_opt_in: false,
  tos_version: TERMS_VERSION,
  tos_accepted_at: '2026-10-29T08:00:00Z',
  ai_safety_ack_at: '2026-10-29T08:00:00Z',
  ai_access_until: null,
};

// ---- Creators and tags ---------------------------------------------------------------------------

export const demoCreators: readonly ProfileRow[] = [
  { id: id('c0', 1), handle: 'harbour_films', display_name: 'Harbour Films', bio: 'Short dramas shot on the coast.', avatar_key: null },
  { id: id('c0', 2), handle: 'tiny_frames', display_name: 'Tiny Frames', bio: 'Stop-motion, one frame at a time.', avatar_key: null },
  { id: id('c0', 3), handle: 'night_owl_studio', display_name: 'Night Owl Studio', bio: 'Mysteries after dark.', avatar_key: null },
];

/** A few of supabase/seeds/10_tags.sql (ids are demo ids, not the database's). */
export const demoTags: readonly TagRow[] = [
  { id: 1, kind: 'genre', slug: 'romance', name_i18n: { en: 'Romance' }, sort: 10 },
  { id: 2, kind: 'genre', slug: 'fantasy', name_i18n: { en: 'Fantasy' }, sort: 20 },
  { id: 3, kind: 'genre', slug: 'mystery', name_i18n: { en: 'Mystery' }, sort: 30 },
  { id: 5, kind: 'genre', slug: 'drama', name_i18n: { en: 'Drama' }, sort: 50 },
  { id: 6, kind: 'genre', slug: 'comedy', name_i18n: { en: 'Comedy' }, sort: 60 },
  { id: 7, kind: 'genre', slug: 'action', name_i18n: { en: 'Action' }, sort: 70 },
  { id: 8, kind: 'genre', slug: 'horror', name_i18n: { en: 'Horror' }, sort: 80 },
  { id: 9, kind: 'genre', slug: 'sci-fi', name_i18n: { en: 'Sci-Fi' }, sort: 90 },
  { id: 21, kind: 'genre', slug: 'slice-of-life', name_i18n: { en: 'Slice of Life' }, sort: 210 },
  { id: 102, kind: 'trope', slug: 'second-chance', name_i18n: { en: 'Second Chance' }, sort: 20 },
  { id: 118, kind: 'trope', slug: 'found-family', name_i18n: { en: 'Found Family' }, sort: 190 },
  { id: 147, kind: 'trope', slug: 'amateur-sleuth', name_i18n: { en: 'Amateur Sleuth' }, sort: 470 },
  { id: 153, kind: 'trope', slug: 'cat-and-mouse', name_i18n: { en: 'Cat and Mouse' }, sort: 540 },
  { id: 177, kind: 'trope', slug: 'ghosts', name_i18n: { en: 'Ghosts' }, sort: 770 },
  { id: 179, kind: 'trope', slug: 'small-town', name_i18n: { en: 'Small Town' }, sort: 790 },
];

// ---- Series and episodes -------------------------------------------------------------------------

interface SeriesSpec {
  n: number;
  slug: string;
  title: string;
  synopsis: string;
  format: SeriesFormat;
  creator: number;
  tags: number[];
  maturity?: SeriesRow['maturity'];
  editorsPick?: boolean;
  completed?: boolean;
  origin?: SeriesRow['origin'];
  /** Coins for episodes after the free ones; null = every episode free. */
  price: number | null;
  episodes: string[];
  seconds: number;
}

const SPECS: SeriesSpec[] = [
  {
    n: 1, slug: 'salt-and-static', title: 'Salt & Static', format: 'live_action', creator: 1, tags: [1, 5, 102], price: 20, seconds: 95,
    synopsis: 'A radio host and the fisherman who keeps calling in after midnight. One summer, one small harbour town, a second chance neither of them asked for.',
    episodes: ['Dead Air', 'Caller Number Nine', 'Low Signal', 'The Harbour Party', 'Static', 'Off the Record', 'Storm Warning', 'Sign-Off'],
  },
  {
    n: 2, slug: 'the-clockmakers-mice', title: 'The Clockmaker’s Mice', format: 'stop_motion', creator: 2, tags: [2, 6, 118], editorsPick: true, price: 15, seconds: 70,
    synopsis: 'Three mice live inside a grandfather clock and keep it ticking. When the clockmaker retires, they have one week to train his clumsy apprentice.',
    episodes: ['Tick', 'Tock', 'The New Hands', 'Oil and Springs', 'Midnight Chime', 'Wound Too Tight', 'Half Past Brave'],
  },
  {
    n: 3, slug: 'night-shift-at-the-wax-museum', title: 'Night Shift at the Wax Museum', format: 'live_action', creator: 3, tags: [8, 3, 177], maturity: 'mature', price: 25, seconds: 110,
    synopsis: 'Her first night as a security guard, Ines notices the figures have moved. Her second night, one of them asks for a light.',
    episodes: ['Orientation', 'Room Four', 'The Missing Hand', 'Candle Hours', 'Restoration', 'Closing Time'],
  },
  {
    n: 4, slug: 'paper-moons', title: 'Paper Moons', format: 'stop_motion', creator: 2, tags: [21, 179], completed: true, price: 10, seconds: 60,
    synopsis: 'A cut-paper town where the moon is replaced every month. This month, the moon-maker has lost her scissors.',
    episodes: ['New Moon', 'Crescent', 'First Quarter', 'Gibbous', 'Full', 'Waning'],
  },
  {
    n: 5, slug: 'low-tide', title: 'Low Tide', format: 'ai_generated', origin: 'ai_story', creator: 3, tags: [3, 147], editorsPick: true, price: 15, seconds: 45,
    synopsis: 'A lighthouse keeper finds a bottle on the sand with her own handwriting inside. A living comic made with AI.',
    episodes: ['The Bottle', 'The Stranger', 'The Lamp', 'Two Keepers', 'Spring Tide', 'The Logbook', 'High Water'],
  },
  {
    n: 6, slug: 'neon-ronin', title: 'Neon Ronin', format: 'ai_generated', origin: 'ai_story', creator: 1, tags: [7, 9, 153], price: null, seconds: 40,
    synopsis: 'A courier with a borrowed sword and a city that never turns its lights off. A living comic made with AI.',
    episodes: ['Delivery', 'Rooftops', 'The Client', 'Rain Check', 'Night Market', 'Blackout'],
  },
];

/** How many episodes are free at the start of every demo series (the catalog's minimum). */
export const DEMO_FREE_EPISODES = 3;

export const demoSeries: readonly SeriesRow[] = SPECS.map((s) => ({
  id: id('5e', s.n),
  creator_id: id('c0', s.creator),
  slug: s.slug,
  title: s.title,
  synopsis: s.synopsis,
  cover_key: null, // demo covers are bundled images: see demoCover() in ./images.ts
  language: 'en',
  format: s.format,
  origin: s.origin ?? 'creator',
  editors_pick: s.editorsPick ?? false,
  maturity: s.maturity ?? 'general',
  status: 'published',
  moderation_status: 'approved',
  free_episode_count: DEMO_FREE_EPISODES,
  default_price_coins: s.price,
  completed: s.completed ?? false,
  tag_ids: s.tags,
  published_at: PUBLISHED,
  created_at: PUBLISHED,
  updated_at: PUBLISHED,
}));

export const demoEpisodes: readonly EpisodeRow[] = SPECS.flatMap((s) =>
  s.episodes.map((title, i): EpisodeRow => {
    const number = i + 1;
    const free = s.price === null || number <= DEMO_FREE_EPISODES;
    return {
      id: id(`e${s.n}`, number),
      series_id: id('5e', s.n),
      number,
      title,
      duration_s: s.seconds - (number % 3) * 5,
      kind: s.format === 'ai_generated' ? 'ai_comic' : 'video',
      // Later episodes cost a little more, in steps of 5 like the real catalog.
      price_coins: free || s.price === null ? null : s.price + (number > 6 ? 5 : 0),
      is_free: free,
      status: 'published',
      moderation_status: 'approved',
      poster_key: null,
      preview_key: null,
      published_at: PUBLISHED,
    };
  }));

export function demoSeriesById(seriesId: string): SeriesRow | undefined {
  return demoSeries.find((s) => s.id === seriesId);
}

export function demoEpisodesOf(seriesId: string): EpisodeRow[] {
  return demoEpisodes.filter((e) => e.series_id === seriesId).sort((a, b) => a.number - b.number);
}

// ---- Wallet ----------------------------------------------------------------------------------------

/** public.get_my_wallet() for the demo account: 150 paid coins, two bonus lots (one expiring soon). */
export function demoWallet(now: Date = new Date()): Wallet {
  const expiring = [
    { coins: 60, expires_at: new Date(now.getTime() + 5 * DAY_MS).toISOString(), source: 'sub_grant' },
    { coins: 30, expires_at: new Date(now.getTime() + 20 * DAY_MS).toISOString(), source: 'trial' },
  ];
  const paid = 150;
  const bonus = expiring.reduce((sum, lot) => sum + lot.coins, 0);
  return { balance: paid + bonus, paid, bonus, refund_debt: 0, expiring, free_passes_left: 1 };
}

// ---- One AI story with a finished first scene ------------------------------------------------------

export const DEMO_STORY_ID = id('a1', 1);
export const DEMO_SCENE_ID = id('a2', 1);

export const demoAiStory: AiStoryRow = {
  id: DEMO_STORY_ID,
  owner_id: DEMO_USER_ID,
  premise: 'A lighthouse keeper finds a message in a bottle, sealed with wax, written in her own handwriting.',
  tags: ['mystery', 'amateur-sleuth'],
  mode: 'comic',
  title: 'Low Tide',
  status: 'active',
  visibility: 'private',
  published_series_id: null,
  created_at: '2026-10-29T08:10:00Z',
  updated_at: '2026-10-29T08:12:00Z',
};

export const demoAiScene: AiSceneRow = {
  id: DEMO_SCENE_ID,
  story_id: DEMO_STORY_ID,
  parent_scene_id: null,
  chosen_choice: null,
  depth: 1,
  status: 'ready',
  title: 'The Bottle',
  is_ending: false,
  created_at: '2026-10-29T08:10:00Z',
};

/** Panel image keys; ./images.ts maps them to bundled pictures (no URLs, no network). */
export const DEMO_PANEL_KEYS = [1, 2, 3, 4].map((n) => `demo/low-tide/panel-${n}.png`);

/** A StoryManifest that passes StoryManifestSchema (checked by the fixture test). */
export const demoManifest: StoryManifest = {
  version: 1,
  story_id: DEMO_STORY_ID,
  scene_id: DEMO_SCENE_ID,
  title: 'The Bottle',
  panels: [
    {
      n: 1, image: DEMO_PANEL_KEYS[0]!, plate: null, focus: { x: 0.62, y: 0.12, w: 0.2, h: 0.12 },
      caption: 'Midnight. The sea had pulled back almost to the horizon.', dialogue: [],
    },
    {
      n: 2, image: DEMO_PANEL_KEYS[1]!, plate: null, focus: { x: 0.36, y: 0.4, w: 0.28, h: 0.16 },
      caption: 'Mara took the lantern down to the shore.',
      dialogue: [{ name: 'Mara', line: 'Hello? Is someone out there?' }],
    },
    {
      n: 3, image: DEMO_PANEL_KEYS[2]!, plate: null, focus: { x: 0.38, y: 0.18, w: 0.24, h: 0.68 },
      caption: 'A figure stood where the water should have been.',
      dialogue: [{ name: 'Stranger', line: 'You’re late, keeper.' }],
    },
    {
      n: 4, image: DEMO_PANEL_KEYS[3]!, plate: null, focus: { x: 0.42, y: 0.34, w: 0.16, h: 0.38 },
      caption: 'At her feet: a bottle sealed with wax, and her own name on the label.',
      dialogue: [{ name: 'Mara', line: 'That’s my handwriting.' }],
    },
  ],
  narration: {
    text: 'The tide went out farther than Mara had ever seen it. Under the moon the wet sand shone like glass, and something green rolled at the edge of the water.',
    audio: null,
    captions_vtt: null,
    duration_ms: null,
  },
  choices: [
    { id: 'a', label: 'Open the bottle', hint: 'Read what it says' },
    { id: 'b', label: 'Follow the stranger', hint: 'Out onto the sand' },
    { id: 'c', label: 'Run back to the lighthouse', hint: 'Light the lamp, just in case' },
  ],
  is_ending: false,
  provenance: {
    ai_generated: true,
    prompt_version: PROMPT_VERSION,
    created_at: '2026-10-29T08:12:00Z',
    models: [
      { task: 'plan', provider: 'meta', model: 'muse-wonder-1.0' },
      { task: 'script', provider: 'meta', model: 'muse-spark-1.3' },
      { task: 'panels', provider: 'meta', model: 'muse-image-1.0' },
    ],
    c2pa_signed: false,
  },
};
