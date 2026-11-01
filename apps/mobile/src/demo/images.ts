// Bundled placeholder pictures for demo mode (generated flat-colour PNGs: no text, no people, no URLs).
// Covers are 3:4, comic panels 9:16 like the real ones. Use with expo-image or <Image source={...}>.

import type { ImageSourcePropType } from 'react-native';
import { DEMO_PANEL_KEYS, demoSeries } from './fixtures';

const COVERS: Record<string, ImageSourcePropType> = {
  'salt-and-static': require('./assets/cover-salt-static.png'),
  'the-clockmakers-mice': require('./assets/cover-clockmaker.png'),
  'night-shift-at-the-wax-museum': require('./assets/cover-wax-museum.png'),
  'paper-moons': require('./assets/cover-paper-moons.png'),
  'low-tide': require('./assets/cover-low-tide.png'),
  'neon-ronin': require('./assets/cover-neon-ronin.png'),
};

const PANELS: Record<string, ImageSourcePropType> = {
  [DEMO_PANEL_KEYS[0]!]: require('./assets/panel-1.png'),
  [DEMO_PANEL_KEYS[1]!]: require('./assets/panel-2.png'),
  [DEMO_PANEL_KEYS[2]!]: require('./assets/panel-3.png'),
  [DEMO_PANEL_KEYS[3]!]: require('./assets/panel-4.png'),
};

/** The cover of a demo series, by id or slug. */
export function demoCover(seriesIdOrSlug: string): ImageSourcePropType | null {
  const series = demoSeries.find((s) => s.id === seriesIdOrSlug || s.slug === seriesIdOrSlug);
  return (series && COVERS[series.slug]) ?? null;
}

/** The picture for a demo manifest's panel `image` key (DEMO_PANEL_KEYS). */
export function demoPanelImage(key: string): ImageSourcePropType | null {
  return PANELS[key] ?? null;
}
