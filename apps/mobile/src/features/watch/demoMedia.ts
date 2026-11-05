// The videos demo mode plays instead of a stream, bundled with the app so demo playback needs no network.
// - The Clockmaker's Mice, episode 1: a real episode made with AI through Higgsfield (GPT Image 2.5 keyframes,
//   Seedance 1.5 Pro shots, Seed Audio narration, ElevenLabs music), 720x1280 H.264 with AAC sound. The series is
//   labelled AI (demo/fixtures.ts). Sources and prompts: prep/episode/clockmaker-ep1 (not in git).
// - Every other demo episode: the placeholder, 12 seconds of slowly moving colour, 360x640 H.264, no sound, no
//   people, no text (generated with ffmpeg's `gradients` source in the token colours).

import { demoEpisodes, demoSeriesById } from '../../demo/fixtures';

export const DEMO_VIDEO: number = require('./assets/demo-episode.mp4');

/** Real demo episodes, by `<series slug>#<episode number>`. */
const EPISODE_VIDEOS: Record<string, number> = {
  'the-clockmakers-mice#1': require('./assets/clockmakers-mice-1.mp4'),
};

/** The bundled video for a demo episode: its own when it has one, otherwise the placeholder. */
export function demoVideoFor(episodeId: string): number {
  const episode = demoEpisodes.find((e) => e.id === episodeId);
  const series = episode ? demoSeriesById(episode.series_id) : undefined;
  return (series && episode && EPISODE_VIDEOS[`${series.slug}#${episode.number}`]) || DEMO_VIDEO;
}
