// The browser side of "Say your choice": the microphone through getUserMedia, its samples through an
// AudioWorklet (public/voice/pcm-capture.js, a same-origin script, so the strict CSP needs no change) or, where
// that can't load, a ScriptProcessor. The samples go to PcmCollector (src/core/wav.ts), which makes the 16 kHz
// mono WAV. Web only: imported by components/VoiceChoice.web.tsx alone, never by native code.
//
// Call startRecording straight from the click handler: the audio context is made before anything is awaited, so
// browsers that need a user gesture to start audio (Safari) get one.

import { PcmCollector, rms, VOICE_MAX_MS, VOICE_MIN_MS } from '../../../core/wav';
import { recorderErrorFromName, type RecorderErrorCode } from '../voiceLogic';

/** Served from apps/mobile/public (copied to the site root by `expo export`). */
const WORKLET_URL = '/voice/pcm-capture.js';
const WORKLET_NAME = 'reeltale-pcm-capture';
const PROCESSOR_FRAMES = 4096;
/** A context that hasn't started by then never will without another click. */
const RESUME_TIMEOUT_MS = 2000;
/** The worklet script is tiny and same-origin; if it hasn't loaded by then, use the ScriptProcessor instead. */
const WORKLET_TIMEOUT_MS = 3000;

export class RecorderError extends Error {
  readonly code: RecorderErrorCode;
  constructor(code: RecorderErrorCode) {
    super(code);
    this.name = 'RecorderError';
    this.code = code;
  }
}

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Can this browser record here? (A secure page, a microphone API, Web Audio.) */
export function recordingSupported(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext === true
    && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && audioContextClass() !== null;
}

export interface Recording {
  /** Stop and return the WAV, or null when it was too short to be speech. */
  stop(): Uint8Array<ArrayBuffer> | null;
  /** Stop and drop everything. */
  cancel(): void;
}

export interface RecordingOptions {
  maxMs?: number;
  /** About 10 times a second while recording: the input level, 0..1. */
  onLevel?: (level: number) => void;
  /** The recording reached maxMs, or the microphone went away: call stop(). */
  onFull?: () => void;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => resolve('timeout'), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e: unknown) => { clearTimeout(id); reject(e); });
  });
}

export async function startRecording(options: RecordingOptions = {}): Promise<Recording> {
  const Ctx = audioContextClass();
  if (!recordingSupported() || !Ctx) throw new RecorderError('not_supported');
  // Made first, inside the click: see the top of the file.
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    throw new RecorderError('not_supported');
  }
  const resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (err) {
    void ctx.close().catch(() => undefined);
    throw new RecorderError(recorderErrorFromName(err instanceof Error ? err.name : undefined));
  }

  let stopped = false;
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  try {
    if ((await withTimeout(resumed, RESUME_TIMEOUT_MS)) === 'timeout' || ctx.state !== 'running') {
      throw new RecorderError('failed');
    }
  } catch (err) {
    stopTracks();
    void ctx.close().catch(() => undefined);
    throw err instanceof RecorderError ? err : new RecorderError('failed');
  }

  const collector = new PcmCollector(ctx.sampleRate, options.maxMs ?? VOICE_MAX_MS);
  let lastLevelAt = 0;
  let announcedFull = false;
  const onSamples = (chunk: Float32Array) => {
    if (stopped) return;
    const now = Date.now();
    if (options.onLevel && now - lastLevelAt > 100) {
      lastLevelAt = now;
      options.onLevel(rms(chunk));
    }
    if (!collector.push(chunk) && !announcedFull) {
      announcedFull = true;
      options.onFull?.();
    }
  };

  const source = ctx.createMediaStreamSource(stream);
  // Nothing is played back: the node runs into a silent gain so the browser keeps pulling samples through it.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);

  let node: AudioNode;
  let detach: () => void;
  try {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('no worklet');
    if ((await withTimeout(ctx.audioWorklet.addModule(WORKLET_URL), WORKLET_TIMEOUT_MS)) === 'timeout') throw new Error('slow worklet');
    const worklet = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    });
    worklet.port.onmessage = (e: MessageEvent<unknown>) => {
      if (e.data instanceof Float32Array) onSamples(e.data);
    };
    node = worklet;
    detach = () => { worklet.port.onmessage = null; worklet.port.close(); };
  } catch {
    // No AudioWorklet here, or its script didn't load: the older ScriptProcessor does the same on the main thread.
    const processor = ctx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
    processor.onaudioprocess = (e: AudioProcessingEvent) => onSamples(e.inputBuffer.getChannelData(0));
    node = processor;
    detach = () => { processor.onaudioprocess = null; };
  }
  source.connect(node);
  node.connect(mute);

  // The microphone unplugged or taken away by the browser: end the recording as if it were full.
  stream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (!stopped && !announcedFull) {
        announcedFull = true;
        options.onFull?.();
      }
    });
  });

  const teardown = () => {
    if (stopped) return;
    stopped = true;
    detach();
    try {
      source.disconnect();
      node.disconnect();
      mute.disconnect();
    } catch {
      // already disconnected
    }
    stopTracks();
    void ctx.close().catch(() => undefined);
  };

  return {
    stop() {
      teardown();
      return collector.durationMs < VOICE_MIN_MS ? null : collector.toWav();
    },
    cancel() {
      teardown();
    },
  };
}
