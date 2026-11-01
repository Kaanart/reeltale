// What usePanelSources (.ts for iOS/Android, .web.ts for the web) hands the comic stage: one picture per
// panel, for expo-image. Shared here so both platform files import the same values.

import type { ImageProps } from 'expo-image';

import { demoPanelImage } from '../../demo';

export type PanelImageSource = NonNullable<ImageProps['source']>;

export interface PanelSource {
  /** Null while it loads, or when it failed. */
  source: PanelImageSource | null;
  failed: boolean;
}

/** Demo pictures (bundled), the same on every platform. */
export function demoPanelSources(keys: readonly string[]): PanelSource[] {
  return keys.map((key) => {
    const source = demoPanelImage(key) as PanelImageSource | null;
    return { source, failed: !source };
  });
}

/** Every panel still loading. */
export function pendingPanelSources(keys: readonly string[]): PanelSource[] {
  return keys.map(() => ({ source: null, failed: false }));
}
