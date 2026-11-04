import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  AI_STEPS, aiSteps, heroActions, landingRedirect, mailtoHref, MODEL_NAMES, modelsUsed, nativeStartPath,
  SUPPORT_EMAIL, VOICE_CHOICES_LIVE, VOICE_STEP,
} from '../../features/landing/logic/landing.ts';

// The landing page's logic: who sees it at '/', its buttons, and an account of the AI pipeline that matches
// the Worker's code.

test('the landing page is for visitors; accounts part-way through the gate go back to their step', () => {
  assert.equal(landingRedirect('signedOut'), null);
  assert.equal(landingRedirect(null), null);
  assert.equal(landingRedirect('age'), '/birthday');
  assert.equal(landingRedirect('blocked'), '/blocked');
  assert.equal(landingRedirect('terms'), '/terms');
  // Adults get Home at '/' from the root layout; the landing never redirects them anywhere.
  assert.equal(landingRedirect('ready'), null);
});

test('the native apps have no landing page: "/" opens sign-in, or the step the account is at', () => {
  assert.equal(nativeStartPath('signedOut'), '/welcome');
  assert.equal(nativeStartPath(null), '/welcome');
  assert.equal(nativeStartPath('age'), '/birthday');
  assert.equal(nativeStartPath('terms'), '/terms');
  assert.equal(nativeStartPath('blocked'), '/blocked');
});

test('the demo build offers the demo account first; the live build starts the normal sign-up', () => {
  assert.deepEqual(heroActions(true), {
    primary: { kind: 'demo' },
    secondary: { kind: 'link', href: '/welcome', labelKey: 'landing:cta.signIn' },
  });
  assert.deepEqual(heroActions(false), {
    primary: { kind: 'link', href: '/welcome', labelKey: 'landing:cta.start' },
    secondary: { kind: 'demoSite' },
  });
});

test('mail links go to the support address, with an encoded subject', () => {
  assert.equal(SUPPORT_EMAIL, 'support@reeltale.net');
  assert.equal(mailtoHref(), 'mailto:support@reeltale.net');
  assert.equal(mailtoHref('  '), 'mailto:support@reeltale.net');
  assert.equal(mailtoHref('Notice: illegal content & more'), 'mailto:support@reeltale.net?subject=Notice%3A%20illegal%20content%20%26%20more');
});

// ---- The AI section says what the code does ---------------------------------------------------------------

const serverAi = (file: string) => readFileSync(new URL(`../../../../server/src/${file}`, import.meta.url), 'utf8');
const scene = serverAi('ai/scene.ts');
const runner = serverAi('workflows/scene-runner.ts');
const meta = serverAi('ai/meta.ts');

/** The model a scene.ts function calls (the first model id inside its body). */
function modelOf(fn: string): string {
  const start = scene.indexOf(`export async function ${fn}(`);
  assert.ok(start >= 0, `${fn} in scene.ts`);
  const next = scene.indexOf('\nexport ', start + 1);
  const bodyText = scene.slice(start, next < 0 ? undefined : next);
  return /'(muse-[a-z0-9.-]+|sam-[0-9.]+)'/.exec(bodyText)?.[1] ?? '';
}

test('each step names the model the Worker really uses for it', () => {
  const byStep = Object.fromEntries(AI_STEPS.map((s) => [s.key, s.model]));
  assert.equal(byStep.check, modelOf('moderateText'));
  assert.match(scene, /export async function planStory[\s\S]*?await moderateText\(deps, 'premise'/, 'the idea is checked before planning');
  assert.equal(byStep.plan, /timed\(deps, 'plan', '([^']+)'/.exec(scene)?.[1]);
  assert.equal(byStep.cast, modelOf('drawCharacterSheets'));
  assert.equal(byStep.script, modelOf('writeScene'));
  assert.equal(byStep.panels, modelOf('drawPanel'));
  assert.equal(byStep.review, modelOf('checkPanels'));
  assert.equal(byStep.framing, modelOf('focusBox'));
  assert.equal(VOICE_STEP.model, /model: '(muse-voice-transcribe[^']*)'/.exec(meta)?.[1]);
});

test('the steps are in the order the Workflow runs them', () => {
  const at = (needle: string) => {
    const i = runner.indexOf(needle);
    assert.ok(i >= 0, needle);
    return i;
  };
  const order = [
    at('planStory('), at('drawCharacterSheets('), at('writeScene('), at('drawPanel('), at('checkPanels('), at('focusBox('),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.deepEqual(AI_STEPS.map((s) => s.key), ['check', 'plan', 'cast', 'script', 'panels', 'review', 'framing']);
  // A flagged panel is redrawn once; a blocked scene is stopped (and refunded by the job).
  assert.match(runner, /outcome\.action === 'redraw'/);
  assert.match(scene, /action: 'block'/);
});

test('voice choices are only mentioned once they are live', () => {
  assert.equal(aiSteps(false).some((s) => s.key === 'voice'), false);
  assert.equal(aiSteps(true).at(-1)?.key, 'voice');
  assert.equal(aiSteps().length, AI_STEPS.length + (VOICE_CHOICES_LIVE ? 1 : 0));
});

test('the landing page claims voice choices exactly when the story player and the Worker have them', () => {
  const app = (file: string) => {
    const url = new URL(`../../${file}`, import.meta.url);
    return existsSync(url) ? readFileSync(url, 'utf8') : '';
  };
  const player = app('features/story/components/SceneChoices.tsx');
  const voiceWeb = app('features/story/components/VoiceChoice.web.tsx');
  const worker = serverAi('app.ts');
  const live =
    /import \{ VoiceChoice \} from '\.\/VoiceChoice'/.test(player) && /<VoiceChoice\b/.test(player) &&
    /useTranscribe\(\)/.test(voiceWeb) &&
    /app\.route\('\/api\/ai', voiceRoutes\)/.test(worker);
  assert.equal(VOICE_CHOICES_LIVE, live, 'set VOICE_CHOICES_LIVE in features/landing/logic/landing.ts to match the code');
});

test('model names are the products’ own, and each step has its strings', () => {
  assert.deepEqual(modelsUsed(AI_STEPS).map((m) => MODEL_NAMES[m]), ['Muse Spark 1.3', 'Muse Wonder 1.0', 'Muse Image 1.0', 'SAM 3.1']);
  const landing = JSON.parse(readFileSync(new URL('../../i18n/en/landing.json', import.meta.url), 'utf8')) as {
    ai: { steps: Record<string, { title: string; body: string }> };
  };
  for (const s of aiSteps(true)) {
    assert.equal(s.titleKey, `landing:ai.steps.${s.key}.title`);
    assert.ok(landing.ai.steps[s.key]?.title, s.key);
    assert.ok(landing.ai.steps[s.key]?.body, s.key);
  }
});
