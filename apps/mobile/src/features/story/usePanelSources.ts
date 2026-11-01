// The pictures of a scene's panels, for expo-image. iOS and Android: the Worker's asset URL with the
// Authorization header (expo-image sends it; the token is read when the scene opens). The web version
// (usePanelSources.web.ts) fetches each picture with the header and shows it as a blob: URL instead,
// because an <img> can't send headers. Demo mode: the bundled pictures, no network.
//
// Files are asked for by name only (panel-1.webp ...): a manifest's `image` is never followed as a URL
// (core/api.ts assetFileFromKey).

import { useEffect, useMemo, useState } from 'react';

import { assetFileFromKey } from '../../core/api';
import { api, isDemo } from '../../lib/data';
import { demoPanelSources, pendingPanelSources as pending, type PanelSource } from './panelSource';

export type { PanelImageSource, PanelSource } from './panelSource';

/** One entry per key, in the same order. `attempt` loads them again (for example after a picture failed). */
export function usePanelSources(sceneId: string, keys: readonly string[], attempt = 0): PanelSource[] {
  const joined = keys.join('\n');
  const stableKeys = useMemo(() => (joined === '' ? [] : joined.split('\n')), [joined]);
  const [live, setLive] = useState<PanelSource[]>(() => pending(stableKeys));

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    setLive(pending(stableKeys));
    void Promise.all(stableKeys.map(async (key): Promise<PanelSource> => {
      const file = assetFileFromKey(key);
      if (!file) return { source: null, failed: true };
      try {
        const { uri, headers } = await api.sceneAssetSource(sceneId, file);
        return { source: { uri, headers, cacheKey: `${sceneId}/${file}` }, failed: false };
      } catch {
        return { source: null, failed: true };
      }
    })).then((sources) => {
      if (!cancelled) setLive(sources);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, stableKeys, attempt]);

  return useMemo(() => (isDemo ? demoPanelSources(stableKeys) : live), [stableKeys, live]);
}
