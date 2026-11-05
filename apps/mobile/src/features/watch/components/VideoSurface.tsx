// One video player (iOS and Android): expo-video's useVideoPlayer + VideoView, no native controls (the page
// draws its own). The page mounts it only inside the player window (logic/pager.ts), so at most three exist;
// unmounting releases the player and its source. VideoSurface.web.tsx is the web version (same props).

import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../../../theme/tokens';
import type { PlaybackSource } from '../hooks';

export interface VideoSurfaceProps {
  source: PlaybackSource;
  /** Play now (the visible page, the screen in front, not paused by the user). Otherwise paused. */
  playing: boolean;
  muted: boolean;
  /** Show the stream's subtitles when it has any. */
  captions: boolean;
  /** Seconds to start from (applied once, when the video is ready). */
  startAt: number;
  /** Jump here whenever this changes (a new object each time, so the same second can be asked twice). */
  seekTo?: { seconds: number } | null;
  /** About once a second while the video moves: position and duration in seconds. */
  onProgress: (positionSeconds: number, durationSeconds: number) => void;
  /** The first frame is on screen: the poster can go. */
  onReady: () => void;
  onEnd: () => void;
  onError: () => void;
  onCaptionsAvailable: (available: boolean) => void;
  /** Web only: the browser refused sound, so playback started muted. Never called natively. */
  onAutoplayMuted?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Within this many seconds of the end, a player counts as finished. */
const END_SLACK_S = 0.25;

function toVideoSource(source: PlaybackSource): VideoSource {
  return source.kind === 'stream' ? { uri: source.uri, contentType: 'hls' } : source.asset;
}

export function VideoSurface(props: VideoSurfaceProps) {
  const { source, playing, muted, captions, startAt, seekTo, style } = props;
  const player = useVideoPlayer(toVideoSource(source), (p) => {
    p.loop = false;
    p.muted = muted;
    p.timeUpdateEventInterval = 1;
    p.keepScreenOnWhilePlaying = true;
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
  });

  const seeked = useRef(false);
  const [subtitleCount, setSubtitleCount] = useState(0);

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay' && !seeked.current) {
      seeked.current = true;
      if (startAt > 0) player.currentTime = startAt;
    }
    if (status === 'error') props.onError();
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => props.onProgress(currentTime, player.duration));
  useEventListener(player, 'playToEnd', () => props.onEnd());
  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) => {
    setSubtitleCount(availableSubtitleTracks.length);
    props.onCaptionsAvailable(availableSubtitleTracks.length > 0);
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (seekTo && Number.isFinite(seekTo.seconds)) player.currentTime = seekTo.seconds;
  }, [player, seekTo]);

  useEffect(() => {
    if (!playing) {
      player.pause();
      return;
    }
    // Played to the end, then tapped: start over (a finished player stays on its last frame).
    if (player.duration > 0 && player.currentTime >= player.duration - END_SLACK_S) player.currentTime = 0;
    player.play();
  }, [player, playing]);

  useEffect(() => {
    const tracks = player.availableSubtitleTracks;
    player.subtitleTrack = captions && tracks.length > 0 ? (tracks.find((t) => t.isDefault) ?? tracks[0] ?? null) : null;
  }, [player, captions, subtitleCount]);

  return (
    <VideoView
      player={player}
      style={[styles.video, style]}
      contentFit="contain"
      nativeControls={false}
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: false }}
      onFirstFrameRender={props.onReady}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  video: { ...StyleSheet.absoluteFill, backgroundColor: colors.playerBg },
});
