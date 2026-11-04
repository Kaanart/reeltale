// The public web pages (landing at '/', /about, /notice) as data: where '/' sends an account, which buttons
// the hero shows, and how an AI scene is made. Pure (no React), tested in src/core/__tests__/landing.test.ts.
//
// The AI steps must say exactly what the Worker does (apps/server/src/ai/scene.ts, run in this order by
// apps/server/src/workflows/scene-runner.ts). The test reads those files and fails when they drift apart.

import { GATE_PATHS, type Gate } from '../../../lib/gate.ts';

/** The public contact address (placeholder until the mailbox is set up). */
export const SUPPORT_EMAIL = 'support@reeltale.net';

/** A mailto: link to the support address, with an optional subject (already translated). */
export function mailtoHref(subject?: string, address: string = SUPPORT_EMAIL): string {
  const s = subject?.replace(/\s+/g, ' ').trim();
  return s ? `mailto:${address}?subject=${encodeURIComponent(s)}` : `mailto:${address}`;
}

// ---- Where '/' goes --------------------------------------------------------------------------------------

type SettledGate = Exclude<Gate, 'loading' | 'error'>;

/**
 * The landing page is for visitors who are signed out. An account that is signed in but not through the gate
 * yet (date of birth, blocked, Terms) is sent to that step instead; null means: show the landing page.
 * Adults never get here: the root layout shows Home at '/' for them.
 */
export function landingRedirect(gate: SettledGate | null): string | null {
  if (gate === 'age' || gate === 'blocked' || gate === 'terms') return GATE_PATHS[gate];
  return null;
}

/** The native apps have no landing page: '/' opens the gate's own screen (sign-in for visitors). */
export function nativeStartPath(gate: SettledGate | null): string {
  return landingRedirect(gate) ?? GATE_PATHS.signedOut;
}

// ---- Calls to action ------------------------------------------------------------------------------------

export type HeroAction =
  /** Demo builds: straight into the demo account (AuthActions.enterDemo). */
  | { kind: 'demo' }
  /** The live website: reload this tab into the demo (lib/env enterWebDemo). */
  | { kind: 'demoSite' }
  /** A link to the sign-in screens. */
  | { kind: 'link'; href: string; labelKey: string };

export interface HeroActions {
  primary: HeroAction;
  secondary: HeroAction;
}

/**
 * The hero's two buttons. A demo build offers the demo account first; a live build has no demo account, so
 * its first button starts the normal sign-up (an email code makes the account on first use).
 */
export function heroActions(isDemo: boolean): HeroActions {
  const signIn: HeroAction = { kind: 'link', href: GATE_PATHS.signedOut, labelKey: 'landing:cta.signIn' };
  if (isDemo) return { primary: { kind: 'demo' }, secondary: signIn };
  // Signing in is also in the top bar, so the second button offers the demo (judges, curious visitors).
  return { primary: { kind: 'link', href: GATE_PATHS.signedOut, labelKey: 'landing:cta.start' }, secondary: { kind: 'demoSite' } };
}

// ---- How an AI scene is made -----------------------------------------------------------------------------

/** Meta model ids as the Worker sends them (apps/server/src/ai/meta.ts, scene.ts). */
export type AiModel = 'muse-spark-1.3' | 'muse-wonder-1.0' | 'muse-image-1.0' | 'sam-3.1' | 'muse-voice-transcribe-1.0';

/** Product names: proper nouns, the same in every language. */
export const MODEL_NAMES: Record<AiModel, string> = {
  'muse-spark-1.3': 'Muse Spark 1.3',
  'muse-wonder-1.0': 'Muse Wonder 1.0',
  'muse-image-1.0': 'Muse Image 1.0',
  'sam-3.1': 'SAM 3.1',
  'muse-voice-transcribe-1.0': 'Muse Voice Transcribe',
};

export type AiStepKey = 'check' | 'plan' | 'cast' | 'script' | 'panels' | 'review' | 'framing' | 'voice';

export interface AiStep {
  key: AiStepKey;
  model: AiModel;
  /** landing:ai.steps.<key>.title / .body */
  titleKey: string;
  bodyKey: string;
}

function step(key: AiStepKey, model: AiModel): AiStep {
  return { key, model, titleKey: `landing:ai.steps.${key}.title`, bodyKey: `landing:ai.steps.${key}.body` };
}

/** The scene pipeline, in the order the Workflow runs it. */
export const AI_STEPS: readonly AiStep[] = [
  step('check', 'muse-spark-1.3'),   // moderateText(premise) before anything is planned
  step('plan', 'muse-wonder-1.0'),   // planStory: the story bible and arc
  step('cast', 'muse-image-1.0'),    // drawCharacterSheets
  step('script', 'muse-spark-1.3'),  // writeScene: captions, dialogue, choices
  step('panels', 'muse-image-1.0'),  // drawPanel, anchored on the character sheets
  step('review', 'muse-spark-1.3'),  // checkPanels: redraw once, or stop and refund
  step('framing', 'sam-3.1'),        // focusBox: the subject the camera moves to
];

/** Saying a choice out loud (POST /api/ai/transcribe, the story track's voice work). */
export const VOICE_STEP: AiStep = step('voice', 'muse-voice-transcribe-1.0');

/**
 * Voice choices are live on the web: the story player's choices carry "Say your choice"
 * (features/story/components/VoiceChoice.web.tsx in SceneChoices) and the Worker mounts POST /api/ai/transcribe.
 * src/core/__tests__/landing.test.ts checks that against the code, so the landing page only ever claims what the
 * product does: switch it off if either side goes.
 */
export const VOICE_CHOICES_LIVE = true;

export function aiSteps(voice: boolean = VOICE_CHOICES_LIVE): readonly AiStep[] {
  return voice ? [...AI_STEPS, VOICE_STEP] : AI_STEPS;
}

/** The distinct models the steps use, in order of first use (for "Made with …" lines). */
export function modelsUsed(steps: readonly AiStep[]): AiModel[] {
  return [...new Set(steps.map((s) => s.model))];
}
