// Web version of usePanelSources.ts (same exports). An <img> can't send the Authorization header, so each
// picture is fetched with it and shown as a blob: URL (the CSP allows blob: images). Every URL made here is
// revoked when the scene closes or the pictures load again, and a fetch that finishes after that is
// revoked at once.

import { useEffect, useMemo, useState } from 'react';

import { assetFileFromKey } from '../../core/api';
import { api, isDemo } from '../../lib/data';
import { demoPanelSources, pendingPanelSources as pending, type PanelSource } from './panelSource';

export type { PanelImageSource, PanelSource } from './panelSource';

export function usePanelSources(sceneId: string, keys: readonly string[], attempt = 0): PanelSource[] {
  const joined = keys.join('\n');
  const stableKeys = useMemo(() => (joined === '' ? [] : joined.split('\n')), [joined]);
  const [live, setLive] = useState<PanelSource[]>(() => pending(stableKeys));

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    const urls: string[] = [];
    setLive(pending(stableKeys));

    stableKeys.forEach((key, i) => {
      const file = assetFileFromKey(key);
      const settle = (next: PanelSource) => setLive((prev) => prev.map((p, j) => (j === i ? next : p)));
      if (!file) {
        settle({ source: null, failed: true });
        return;
      }
      api.fetchSceneAsset(sceneId, file, { signal: controller.signal }).then(
        (blob) => {
          const url = URL.createObjectURL(blob);
          if (controller.signal.aborted) {
            URL.revokeObjectURL(url);
            return;
          }
          urls.push(url);
          settle({ source: { uri: url }, failed: false });
        },
        () => {
          if (!controller.signal.aborted) settle({ source: null, failed: true });
        },
      );
    });

    return () => {
      controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [sceneId, stableKeys, attempt]);

  return useMemo(() => (isDemo ? demoPanelSources(stableKeys) : live), [stableKeys, live]);
}
