import type { ChoiceView } from '../logic';

// "Say your choice": a microphone button beside the choices that records a few seconds, has Meta's Muse Voice
// Transcribe turn it into text (POST /api/ai/transcribe) and takes the choice the words name.
//
// This file is the iOS/Android version, and it shows nothing: voice choice is web first (a native recorder and
// its permission strings come later). The web version is VoiceChoice.web.tsx, with the same props.

export interface VoiceChoiceProps {
  /** The choices on screen, in order (A, B, C). */
  choices: readonly ChoiceView[];
  /** True while new scenes can't be asked for (no AI consent, the story ended, the price unknown). */
  newDisabled: boolean;
  /** A choice is being sent: the microphone waits. */
  busy: boolean;
  /** Take a choice, exactly as a tap would. */
  onChoose: (choice: ChoiceView) => void;
}

export function VoiceChoice(_props: VoiceChoiceProps): null {
  return null;
}
