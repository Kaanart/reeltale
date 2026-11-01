// One video player on the web: a plain <video>. Browsers with native HLS (Safari) play the signed stream
// directly; the rest go through hls.js, loaded on first use. hls.js runs without its Web Worker
// (enableWorker: false): the site's CSP has no `worker-src blob:`. Unmounting detaches and destroys
// everything, like the native player is released. Same props as VideoSurface.tsx.

import { Asset } from 'expo-asset';
import type Hls from 'hls.js';
import { useEffect, useRef, type CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '../../../theme/tokens';
import type { VideoSurfaceProps } from './VideoSurface';

const HLS_TYPE = 'application/vnd.apple.mpegurl';

const VIDEO_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'contain',
  backgroundColor: colors.playerBg,
};

/** Turn the stream's subtitles on or off. Returns whether there are any. */
function syncCaptions(video: HTMLVideoElement, hls: Hls | null, on: boolean): boolean {
  if (hls) {
    const tracks = hls.subtitleTracks;
    hls.subtitleDisplay = on;
    hls.subtitleTrack = on && tracks.length > 0 ? Math.max(0, tracks.findIndex((t) => t.default)) : -1;
    return tracks.length > 0;
  }
  const tracks = Array.from(video.textTracks).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  tracks.forEach((t, i) => {
    t.mode = on && i === 0 ? 'showing' : 'disabled';
  });
  return tracks.length > 0;
}

/**
 * play(), and if the browser refuses sound without a tap (autoplay policy), play muted instead and say so,
 * so the mute button shows "Unmute".
 */
function tryPlay(video: HTMLVideoElement, onMuted: () => void): void {
  video.play().catch((err: unknown) => {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' && !video.muted) {
      video.muted = true;
      onMuted();
      video.play().catch(() => undefined);
    }
    // AbortError (a pause() arrived first) and a missing source (hls.js still loading) need nothing:
    // 'canplay' tries again.
  });
}

export function VideoSurface(props: VideoSurfaceProps) {
  const { source, playing, muted, captions, style } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  // Event handlers read the newest props without re-attaching the source.
  const latest = useRef(props);
  latest.current = props;

  const isStream = source.kind === 'stream';
  const uri = source.kind === 'stream' ? source.uri : Asset.fromModule(source.asset).uri;

  // Attach the source; detach and release it when the URL changes or the page leaves the window.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;
    let seeked = false;
    const p = () => latest.current;
    const muteCallback = () => p().onAutoplayMuted?.();

    const reportCaptions = () => p().onCaptionsAvailable(syncCaptions(video, hlsRef.current, p().captions));
    const onLoadedMetadata = () => {
      if (seeked) return;
      seeked = true;
      const at = p().startAt;
      if (at > 0) video.currentTime = at;
    };
    const onCanPlay = () => {
      if (p().playing && video.paused) tryPlay(video, muteCallback);
    };
    const onTime = () => p().onProgress(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0);
    const onLoadedData = () => p().onReady();
    const onEnded = () => p().onEnd();
    const onError = () => p().onError();

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.textTracks.addEventListener('addtrack', reportCaptions);

    if (!isStream || video.canPlayType(HLS_TYPE)) {
      video.src = uri;
    } else {
      import('hls.js').then(
        ({ default: HlsClass }) => {
          if (cancelled) return;
          if (!HlsClass.isSupported()) {
            p().onError();
            return;
          }
          const hls = new HlsClass({ enableWorker: false, capLevelToPlayerSize: true });
          hls.subtitleDisplay = false;
          hlsRef.current = hls;
          hls.on(HlsClass.Events.ERROR, (_event, data) => {
            if (data.fatal) p().onError();
          });
          hls.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, reportCaptions);
          hls.loadSource(uri);
          hls.attachMedia(video);
        },
        () => {
          if (!cancelled) p().onError();
        },
      );
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.textTracks.removeEventListener('addtrack', reportCaptions);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [uri, isStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) tryPlay(video, () => latest.current.onAutoplayMuted?.());
    else video.pause();
  }, [playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) syncCaptions(video, hlsRef.current, captions);
  }, [captions]);

  return (
    <View style={[styles.box, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <video
        ref={videoRef}
        style={VIDEO_STYLE}
        playsInline
        preload="auto"
        muted={muted}
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { ...StyleSheet.absoluteFill, backgroundColor: colors.playerBg },
});
