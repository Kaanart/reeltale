import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { ApiError } from '../../../core/api';
import { describeError } from '../../../core/errors';
import { isDemo } from '../../../lib/data';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { TextLink } from '../../auth';
import type { ChoiceView } from '../logic';
import { RecorderError, recordingSupported, startRecording, type Recording } from '../voice/webRecorder';
import { useForgetVoiceConsent, useTranscribe, useVoiceConsent } from '../voiceHooks';
import { matchVoiceChoice, recorderErrorKey, secondsLeft, voiceErrorView, voiceOutcome } from '../voiceLogic';
import type { VoiceChoiceProps } from './VoiceChoice';
import { VoiceConsentCard } from './VoiceConsentCard';

// "Say your choice" on the web (VoiceChoice.tsx explains the feature; the native apps show nothing yet).
//
//   press the microphone -> (first time: the voice consent step) -> listening, up to 8 s, with a level meter and
//   the seconds left -> "Done" (or the 8 s run out) -> the recording, as a 16 kHz WAV, goes to POST
//   /api/ai/transcribe -> the words are matched to a choice (voiceLogic.ts matchVoiceChoice) -> that choice is
//   taken exactly like a tap, or the reader is told what was heard and asked again.
//
// Escape or Cancel drops a recording without sending it. Demo mode records on the device only and uses a canned
// answer (voiceHooks.ts): nothing is sent. Nothing said is kept here after the screen moves on, and nothing is logged.

type Phase = 'idle' | 'consent' | 'starting' | 'listening' | 'transcribing';

interface Note {
  /** What the transcription heard, when there is something to show. */
  heard: string | null;
  key: string;
  params?: Record<string, string | number>;
  tone: 'info' | 'error';
}

const ICON = 20;
const NOTE_ICON = 16;
const TICK_MS = 250;
/** Speech sits around 0.05-0.2 RMS; this makes the meter move visibly. */
const METER_GAIN = 4;

export function VoiceChoice(props: VoiceChoiceProps) {
  const [supported] = useState(recordingSupported);
  // A browser that can't record here (no microphone API, or a page that isn't secure) gets no button at all.
  if (!supported) return null;
  return <VoiceChoiceWeb {...props} />;
}

function VoiceChoiceWeb({ choices, newDisabled, busy, onChoose }: VoiceChoiceProps) {
  const { t } = useTranslation();
  const consent = useVoiceConsent();
  const forgetConsent = useForgetVoiceConsent();
  const transcribe = useTranscribe();
  const mic = useInteraction();

  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<Note | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [level, setLevel] = useState(0);

  const recording = useRef<Recording | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Each start gets a number; anything that answers for an older one (a late permission prompt, a slow
  // transcription after Cancel) is ignored.
  const run = useRef(0);
  const alive = useRef(true);
  // The latest props, for answers that arrive after a re-render.
  const latest = useRef({ choices, newDisabled, busy, onChoose });
  useEffect(() => {
    latest.current = { choices, newDisabled, busy, onChoose };
  }, [choices, newDisabled, busy, onChoose]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      run.current += 1;
      recording.current?.cancel();
      recording.current = null;
      abort.current?.abort();
      abort.current = null;
    };
  }, []);

  const cancel = () => {
    run.current += 1;
    recording.current?.cancel();
    recording.current = null;
    abort.current?.abort();
    abort.current = null;
    setLevel(0);
    setNote(null);
    setPhase('idle');
  };

  const showText = (text: string) => {
    const heard = text.trim();
    if (heard === '') {
      setNote({ heard: null, key: 'story:voice.nothingHeard', tone: 'error' });
      return;
    }
    const { choices: options, newDisabled: closed, busy: sending, onChoose: take } = latest.current;
    const match = matchVoiceChoice(heard, options.map(({ id, label, hint }) => ({ id, label, hint })));
    const outcome = voiceOutcome<ChoiceView>(match, options, closed);
    if (outcome.kind === 'take' && !sending) {
      setNote({
        heard,
        key: 'story:voice.choosing',
        params: { letter: outcome.choice.id.toUpperCase(), label: outcome.choice.label },
        tone: 'info',
      });
      take(outcome.choice);
    } else if (outcome.kind === 'unavailable') {
      const key = outcome.reason === 'blocked' ? 'story:voice.blockedChoice' : 'story:voice.unavailableChoice';
      setNote({ heard, key, params: { letter: outcome.choice.id.toUpperCase() }, tone: 'error' });
    } else if (outcome.kind === 'unsure') {
      setNote({ heard, key: 'story:choices.voiceNoMatch', tone: 'error' });
    }
  };

  const showError = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'aborted') return;
      const view = voiceErrorView(err.code);
      if (view.consent) {
        // Withdrawn elsewhere (Settings, another device): ask again before anything else is sent.
        forgetConsent();
        setPhase('consent');
        return;
      }
      if (view.key) {
        setNote({ heard: null, key: view.key, tone: 'error' });
        return;
      }
    }
    const info = describeError(err);
    setNote({ heard: null, key: info.key, params: info.params, tone: 'error' });
  };

  const finish = () => {
    const rec = recording.current;
    if (!rec) return;
    recording.current = null;
    const mine = run.current;
    const wav = rec.stop();
    setLevel(0);
    if (!wav) {
      setPhase('idle');
      setNote({ heard: null, key: 'story:voice.nothingHeard', tone: 'error' });
      return;
    }
    setPhase('transcribing');
    const controller = new AbortController();
    abort.current = controller;
    transcribe.mutate(
      { wav, signal: controller.signal },
      {
        onSuccess: ({ text }) => {
          if (!alive.current || run.current !== mine) return;
          abort.current = null;
          setPhase('idle');
          showText(text);
        },
        onError: (err) => {
          if (!alive.current || run.current !== mine) return;
          abort.current = null;
          setPhase('idle');
          showError(err);
        },
      },
    );
  };

  // The recorder says it is full (8 s) or the microphone went away: send what there is.
  const finishLatest = useRef(finish);
  useEffect(() => {
    finishLatest.current = finish;
  });

  const start = async () => {
    run.current += 1;
    const mine = run.current;
    setNote(null);
    setLevel(0);
    setPhase('starting');
    try {
      // Called inside the click: the recorder makes its audio context before it waits for anything.
      const rec = await startRecording({
        onLevel: (value) => {
          if (run.current === mine) setLevel(value);
        },
        onFull: () => {
          if (run.current === mine) finishLatest.current();
        },
      });
      if (!alive.current || run.current !== mine) {
        rec.cancel();
        return;
      }
      recording.current = rec;
      const at = Date.now();
      setStartedAt(at);
      setNow(at);
      setPhase('listening');
    } catch (err) {
      if (!alive.current || run.current !== mine) return;
      setPhase('idle');
      setNote({ heard: null, key: recorderErrorKey(err instanceof RecorderError ? err.code : 'failed'), tone: 'error' });
    }
  };

  // The seconds left, while listening. The recorder itself stops at 8 s (onFull); this only draws the count.
  useEffect(() => {
    if (phase !== 'listening') return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [phase]);

  // Escape drops the recording (or the transcription on its way) without taking anything.
  const cancelLatest = useRef(cancel);
  useEffect(() => {
    cancelLatest.current = cancel;
  });
  useEffect(() => {
    if (phase !== 'starting' && phase !== 'listening' && phase !== 'transcribing') return undefined;
    if (typeof document === 'undefined') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      cancelLatest.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase]);

  const onMic = () => {
    if (phase === 'listening') {
      finish();
      return;
    }
    if (phase !== 'idle' || busy) return;
    if (consent.data === true) {
      void start();
    } else if (consent.data === false) {
      setNote(null);
      setPhase('consent');
    } else if (consent.error) {
      const info = describeError(consent.error);
      setNote({ heard: null, key: info.key, params: info.params, tone: 'error' });
      void consent.refetch();
    }
  };

  const listening = phase === 'listening';
  const working = phase === 'starting' || phase === 'transcribing';
  const disabled = busy || working || phase === 'consent' || (phase === 'idle' && consent.isPending);
  const label = listening ? t('story:voice.stop') : t('story:choices.sayYourChoice');
  const status = phase === 'starting'
    ? t('story:voice.starting')
    : listening ? t('story:voice.listening')
    : phase === 'transcribing' ? t('story:voice.transcribing')
    : null;
  const meter = `${Math.round(Math.min(1, level * METER_GAIN) * 100)}%` as const;

  return (
    <View style={styles.root} testID="story-voice">
      <View style={styles.row}>
        <Pressable
          onPress={onMic}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={listening ? undefined : t('story:voice.hint')}
          accessibilityState={{ disabled, busy: working }}
          {...mic.handlers}
          style={({ pressed }) => [
            styles.mic,
            listening && styles.micOn,
            (mic.hovered || pressed) && !disabled && (listening ? styles.micOnHover : styles.micHover),
            disabled && !working && styles.micDisabled,
            mic.focusVisible && focusRing,
          ]}
          testID="story-voice-mic"
        >
          {working ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Ionicons name={listening ? 'stop' : 'mic'} size={ICON} color={listening ? colors.onAccent : colors.ink} />
          )}
          <Text variant="body" color={listening ? 'onAccent' : 'ink'} style={styles.micLabel}>
            {label}
          </Text>
        </Pressable>
        {/* Always there, so screen readers hear each change of state. */}
        <Text variant="bodySmall" color="inkMuted" accessibilityLiveRegion="polite" testID="story-voice-status">
          {status ?? ''}
        </Text>
        {listening ? (
          <View style={styles.listening}>
            <View style={styles.meter} aria-hidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.meterFill, { width: meter }]} />
            </View>
            <Text variant="caption" color="inkMuted" style={styles.seconds}>
              {t('story:voice.secondsLeft', { count: secondsLeft(now - startedAt) })}
            </Text>
          </View>
        ) : null}
        {working || listening ? (
          <TextLink label={t('common:actions.cancel')} onPress={cancel} testID="story-voice-cancel" />
        ) : null}
      </View>

      {phase === 'consent' ? (
        <VoiceConsentCard
          onAllowed={() => {
            setPhase('idle');
            setNote({ heard: null, key: 'story:voice.consentGiven', tone: 'info' });
          }}
          onDecline={() => setPhase('idle')}
        />
      ) : null}

      {note ? (
        <View style={styles.note} accessibilityLiveRegion="polite" testID="story-voice-note">
          {note.heard ? (
            <Text variant="bodySmall" color="inkMuted" style={styles.heard}>
              {t('story:choices.voiceHeard', { text: note.heard })}
            </Text>
          ) : null}
          <View style={styles.noteRow}>
            <Ionicons
              name={note.tone === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
              size={NOTE_ICON}
              color={note.tone === 'error' ? colors.danger : colors.success}
              style={styles.noteIcon}
            />
            <Text variant="bodySmall" accessibilityRole={note.tone === 'error' ? 'alert' : undefined} style={styles.noteText}>
              {t(note.key, note.params)}
            </Text>
          </View>
        </View>
      ) : null}

      {phase === 'idle' && !note ? (
        <Text variant="caption" color="inkMuted">
          {t('story:voice.hint')}
        </Text>
      ) : null}
      <Text variant="caption" color="inkMuted">
        {isDemo ? t('story:voice.demoNote') : t('story:voice.privacy')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  mic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.minTarget,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  micHover: { backgroundColor: colors.surfaceAlt },
  micOn: { backgroundColor: colors.accentStrong, borderColor: colors.accentStrong },
  micOnHover: { backgroundColor: colors.accentStrongPressed, borderColor: colors.accentStrongPressed },
  micDisabled: { opacity: 0.5 },
  micLabel: { fontFamily: fonts.sansMedium },
  listening: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexGrow: 1 },
  meter: {
    flexGrow: 1,
    maxWidth: layout.sidePanelWidth / 3,
    height: space.xs + space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accentStrong },
  seconds: { fontFamily: fonts.sansMedium },
  note: { gap: space.xs },
  heard: { fontStyle: 'italic' },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  noteIcon: { marginTop: space.xs / 2 },
  noteText: { flex: 1 },
});
