import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Wallet } from '@reeltale/shared';
import { comicTimeline, revealPlan } from '../comic.ts';
import { demoManifest } from '../../demo/fixtures.ts';
import {
  affordability, AI_CONSENT_VERSION, AI_MAX_TAGS, AI_PREMISE_MAX, AI_PREMISE_MIN, asUuid, checkPremise, chooseOutcome,
  clockPosition, DEFAULT_AI_PRICES, describeChoices, describeScene, errorWithoutData, failureActions, hasStoryConsent,
  offeredFailureActions, parseAiPrices, PLAYER_ROUTE, providerKey, readingPaced, RequestIds, RequestIdsByUser, SCENE_POLL_MS, SCENE_POLL_RETRY_MS,
  sceneBelow, scenePollMs, sceneToOpen, skipTarget, spendCoins, startFingerprint, startRequestSpent, storyListTitle, storyStatusKey, storyTags,
  storyTakesChoices, tagName, taskKey, toggleTag, visibleText, withLoadFailures,
} from '../../features/story/logic.ts';
import {
  parseConsentRow, parseJobRow, parseRows, parseSceneHead, parseSceneRow, parseStoryRow,
} from '../../features/story/types.ts';
import type { TagRow } from '../../lib/types.ts';

// The AI story track's rules (src/features/story/logic.ts and the row checks in types.ts).

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

// ---- Consent ---------------------------------------------------------------------------------------

const consent = { purpose: 'story' as const, providers: ['meta', 'google'], version: AI_CONSENT_VERSION, withdrawn_at: null };

test('story consent: current, not withdrawn, every provider, this policy version or later', () => {
  assert.equal(hasStoryConsent(consent), true);
  assert.equal(hasStoryConsent({ ...consent, version: '2099-01-01' }), true);
  assert.equal(hasStoryConsent({ ...consent, providers: ['google', 'meta', 'cloudflare'] }), true);
  assert.equal(hasStoryConsent(null), false);
  assert.equal(hasStoryConsent(undefined), false);
  assert.equal(hasStoryConsent({ ...consent, withdrawn_at: '2026-10-29T10:00:00Z' }), false);
  assert.equal(hasStoryConsent({ ...consent, providers: ['meta'] }), false, 'Google reads the narration');
  assert.equal(hasStoryConsent({ ...consent, version: '2026-01-01' }), false, 'an older policy asks again');
  assert.equal(hasStoryConsent({ ...consent, version: 'v1' }), false);
  assert.equal(hasStoryConsent({ ...consent, purpose: 'voice' }), false);
});

// ---- The opening ------------------------------------------------------------------------------------

test('the opening is trimmed and must be 20 to 1000 characters, like the Worker', () => {
  assert.deepEqual(checkPremise(`  ${'a'.repeat(AI_PREMISE_MIN)}  `), { ok: true, premise: 'a'.repeat(AI_PREMISE_MIN) });
  assert.deepEqual(checkPremise('a'.repeat(AI_PREMISE_MIN - 1)), { ok: false, problem: 'too_short', length: AI_PREMISE_MIN - 1 });
  assert.deepEqual(checkPremise('   '), { ok: false, problem: 'too_short', length: 0 });
  assert.equal(checkPremise('a'.repeat(AI_PREMISE_MAX)).ok, true);
  assert.deepEqual(checkPremise('a'.repeat(AI_PREMISE_MAX + 1)), { ok: false, problem: 'too_long', length: AI_PREMISE_MAX + 1 });
  assert.equal(AI_PREMISE_MIN, 20);
  assert.equal(AI_PREMISE_MAX, 1000);
});

test('tags toggle on and off, never past ten, and only slugs the Worker accepts', () => {
  assert.equal(AI_MAX_TAGS, 10);
  const before = ['mystery'];
  const added = toggleTag(before, 'romance');
  assert.deepEqual(added, ['mystery', 'romance']);
  assert.deepEqual(before, ['mystery'], 'the input is not changed');
  assert.deepEqual(toggleTag(added, 'mystery'), ['romance']);
  const ten = Array.from({ length: AI_MAX_TAGS }, (_, i) => `tag-${i}`);
  assert.deepEqual(toggleTag(ten, 'one-more'), ten);
  assert.deepEqual(toggleTag(ten, 'tag-3').length, AI_MAX_TAGS - 1, 'removing works at the limit');
  assert.deepEqual(toggleTag([], 'Bad Slug'), []);
  assert.deepEqual(toggleTag([], 'x'), [], 'too short');
});

const tag = (id: number, kind: TagRow['kind'], slug: string, sort: number, names: Record<string, string> = {}): TagRow =>
  ({ id, kind, slug, sort, name_i18n: { en: slug, ...names } });

test('story tags: genres and tropes in order, never content warnings or odd slugs', () => {
  const groups = storyTags([
    tag(1, 'trope', 'enemies-to-lovers', 2), tag(2, 'genre', 'romance', 2), tag(3, 'genre', 'mystery', 1),
    tag(4, 'warning', 'violence', 0), tag(5, 'genre', 'Bad Slug', 0), tag(6, 'trope', 'amateur-sleuth', 1),
  ]);
  assert.deepEqual(groups.genres.map((t) => t.slug), ['mystery', 'romance']);
  assert.deepEqual(groups.tropes.map((t) => t.slug), ['amateur-sleuth', 'enemies-to-lovers']);
});

test('a tag is named in the reader’s language, then its base language, then English, then by slug', () => {
  const t = tag(1, 'genre', 'mystery', 0, { en: 'Mystery', de: 'Krimi', 'pt-BR': 'Mistério' });
  assert.equal(tagName(t, 'pt-BR'), 'Mistério');
  assert.equal(tagName(t, 'de-AT'), 'Krimi');
  assert.equal(tagName(t, 'fr'), 'Mystery');
  assert.equal(tagName({ slug: 'noir', name_i18n: { en: '' } as TagRow['name_i18n'] }, 'en'), '');
});

// ---- Prices -----------------------------------------------------------------------------------------

test('AI prices come from pricing_config, and missing or odd values keep the SQL defaults', () => {
  assert.deepEqual(DEFAULT_AI_PRICES, { storyStart: 50, comicScene: 30 });
  assert.deepEqual(parseAiPrices(null), DEFAULT_AI_PRICES);
  assert.deepEqual(parseAiPrices([{ key: 'ai_story_start_coins', value: 60 }, { key: 'ai_comic_scene_coins', value: '35' }]),
    { storyStart: 60, comicScene: 35 });
  assert.deepEqual(parseAiPrices([
    { key: 'ai_story_start_coins', value: -5 }, { key: 'ai_comic_scene_coins', value: 'thirty' },
    { key: 'default_price_short', value: 25 }, { key: '__proto__', value: 1 }, null, 'x',
  ]), DEFAULT_AI_PRICES);
  assert.deepEqual(parseAiPrices([{ key: 'ai_story_start_coins', value: 12.5 }]), DEFAULT_AI_PRICES);
});

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  balance: 240, paid: 150, bonus: 90, refund_debt: 0, free_passes_left: 1,
  expiring: [
    { coins: 30, expires_at: '2026-11-20T00:00:00Z', source: 'trial' },
    { coins: 60, expires_at: '2026-11-05T00:00:00Z', source: 'sub_grant' },
  ],
  ...over,
});

test('affordability: unknown until the wallet loads, debt blocks, otherwise the balance decides', () => {
  assert.equal(affordability(null, 50), 'unknown');
  assert.equal(affordability(wallet(), 240), 'ok');
  assert.equal(affordability(wallet(), 241), 'short');
  assert.equal(affordability(wallet({ refund_debt: 5 }), 10), 'debt');
});

test('demo spending takes the soonest-expiring bonus coins first, then paid coins', () => {
  const after = spendCoins(wallet(), 70);
  assert.deepEqual(after.expiring, [{ coins: 20, expires_at: '2026-11-20T00:00:00Z', source: 'trial' }]);
  assert.equal(after.bonus, 20);
  assert.equal(after.paid, 150);
  assert.equal(after.balance, 170);
  const deep = spendCoins(wallet(), 100);
  assert.deepEqual(deep.expiring, []);
  assert.equal(deep.paid, 140);
  assert.equal(deep.balance, 140);
  assert.deepEqual(spendCoins(wallet(), 241), wallet(), 'can’t pay: unchanged');
  assert.deepEqual(spendCoins(wallet(), 0), wallet());
});

// ---- One request id per tap ---------------------------------------------------------------------------

test('a retried tap reuses its request id; a new opening or a start that went through gets a new one', () => {
  let n = 0;
  const ids = new RequestIds(() => `id-${++n}`);
  const fp = startFingerprint(' A lighthouse keeper finds a letter. ', ['b-tag', 'a-tag']);
  assert.equal(fp, startFingerprint('A lighthouse keeper finds a letter.', ['a-tag', 'b-tag']), 'trim and tag order don’t matter');
  const first = ids.idFor(fp);
  assert.equal(ids.idFor(fp), first, 'retry after a failure: same id, so the server returns the same story');
  const other = ids.idFor(startFingerprint('A different opening entirely.', []));
  assert.notEqual(other, first);
  assert.notEqual(ids.idFor(fp), first, 'changed back: a new request');
  ids.succeeded();
  assert.notEqual(ids.idFor(fp), `id-${n - 1}`);
  assert.equal(n, 4);
});

test('start request ids outlive the screen, per reader, and are let go only by their own answer', () => {
  let n = 0;
  const book = new RequestIdsByUser(() => `id-${++n}`);
  const fp = startFingerprint('A night train stops at a station that isn’t on any map.', []);
  // The first visit to story/new sent a start whose answer never came (a timeout, or the reader left).
  const first = book.for(U1).idFor(fp);
  // A reopened screen is handed the same RequestIds, so the same opening is still the same request.
  assert.equal(book.for(U1), book.for(U1));
  assert.equal(book.for(U1).idFor(fp), first, 'a retry from a reopened screen reuses the id');
  assert.notEqual(book.for('22222222-2222-4222-8222-222222222222').idFor(fp), first, 'another reader never shares it');

  // An answer for an older id doesn't let go of the current one.
  const ids = book.for(U1);
  ids.finished('id-old');
  assert.equal(ids.idFor(fp), first);
  ids.finished(first);
  assert.notEqual(ids.idFor(fp), first, 'the start went through: the next tap is a new request');
});

test('only a start the server already made and refunded uses its request id up', () => {
  assert.equal(startRequestSpent('generation_unavailable'), true);
  for (const code of ['network_error', 'timeout', 'aborted', 'unknown_error', 'insufficient_coins', 'ai_consent_required', 'rate_limited']) {
    assert.equal(startRequestSpent(code), false, code);
  }
});

// ---- Scenes -------------------------------------------------------------------------------------------

const job = (status: string, progress: string | null = null, error_code: string | null = null, kind: 'story_start' | 'scene' = 'scene') =>
  ({ kind, status: status as 'queued', progress, error_code });

test('a scene being made polls and shows the job’s step', () => {
  const v = describeScene({ status: 'generating', parent_scene_id: U1 }, job('running', 'drawing'));
  assert.equal(v.phase, 'working');
  assert.equal(v.polling, true);
  assert.equal(v.job.key, 'ai:progress.drawing');
  assert.equal(v.kind, 'scene');
  const root = describeScene({ status: 'queued', parent_scene_id: null }, null);
  assert.equal(root.kind, 'story_start', 'no job yet: the first scene of a story');
  assert.equal(root.job.key, 'ai:progress.queued');
  assert.equal(root.polling, true);
});

test('the scene row decides once it is final; a finished job decides while the row lags', () => {
  assert.deepEqual(describeScene({ status: 'ready', parent_scene_id: U1 }, job('running', 'framing')).phase, 'ready');
  assert.equal(describeScene({ status: 'generating', parent_scene_id: U1 }, job('succeeded', 'ready')).phase, 'ready');
  const lagBlocked = describeScene({ status: 'generating', parent_scene_id: U1 }, job('failed', 'checking', 'blocked:violence'));
  assert.equal(lagBlocked.phase, 'blocked');
  assert.equal(lagBlocked.polling, false);
  assert.equal(lagBlocked.failureKey, 'ai:failure.blocked');
  // A failed row with a "blocked" job reason is still a failure the reader may retry.
  const failed = describeScene({ status: 'failed', parent_scene_id: U1 }, job('failed', null, 'blocked:x'));
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.failureKey, 'ai:failure.failed');
  assert.equal(describeScene({ status: 'failed', parent_scene_id: U1 }, job('failed', null, 'daily_budget_exceeded')).failureKey, 'ai:failure.paused');
});

test('what a reader can do about a failure: edit the opening, try another path, or retry a failed one', () => {
  assert.deepEqual(failureActions('failed', true), ['edit']);
  assert.deepEqual(failureActions('blocked', true), ['edit']);
  assert.deepEqual(failureActions('failed', false), ['tryAnother', 'retry']);
  assert.deepEqual(failureActions('blocked', false), ['tryAnother'], 'a blocked path is never retried');
  const blocked = describeScene({ status: 'blocked', parent_scene_id: null }, job('failed', null, 'blocked:x', 'story_start'));
  assert.deepEqual(blocked.actions, ['edit']);
  assert.equal(blocked.failureKey, 'ai:failure.blocked');
});

test('a paid retry is offered only while the story takes new scenes and the scene price is known', () => {
  const both = ['tryAnother', 'retry'] as const;
  assert.deepEqual(offeredFailureActions(both, 'active', true), ['tryAnother', 'retry']);
  assert.deepEqual(offeredFailureActions(both, null, true), ['tryAnother', 'retry'], 'story not loaded: the server decides');
  assert.deepEqual(offeredFailureActions(both, 'completed', true), ['tryAnother'], 'svc.ai_choose refuses once an ending is reached');
  assert.deepEqual(offeredFailureActions(both, 'active', false), ['tryAnother'], 'no price, no paid button');
  assert.deepEqual(offeredFailureActions(['edit'], 'failed', false), ['edit']);
});

test('a scene being made is polled every 2 s, more slowly after a failed poll, and never once final', () => {
  assert.equal(SCENE_POLL_MS, 2000);
  assert.ok(SCENE_POLL_RETRY_MS > SCENE_POLL_MS);
  assert.equal(scenePollMs(null, false), SCENE_POLL_MS, 'first load still on its way');
  assert.equal(scenePollMs(null, true), false, 'nothing loaded and it failed: the screen offers a retry');
  assert.equal(scenePollMs({ polling: true }, false), SCENE_POLL_MS);
  assert.equal(scenePollMs({ polling: true }, true), SCENE_POLL_RETRY_MS, 'a network blip mid-job keeps the progress going');
  assert.equal(scenePollMs({ polling: false }, false), false);
  assert.equal(scenePollMs({ polling: false }, true), false);
});

test('a failed background refresh never replaces what was loaded', () => {
  const err = new Error('network_error');
  assert.equal(errorWithoutData({ data: undefined, error: err }), err);
  assert.equal(errorWithoutData({ data: { status: 'ready' }, error: err }), null);
  assert.equal(errorWithoutData({ data: null, error: err }), null, 'null is an answer (a story with no scene to open)');
  assert.equal(errorWithoutData({ data: undefined, error: null }), null);
});

test('a picture the image view couldn’t show is marked failed, so the retry note appears', () => {
  const src = [{ source: 'a', failed: false }, { source: 'b', failed: false }, { source: null, failed: true }];
  assert.equal(withLoadFailures(src, []), src, 'nothing failed: the same list');
  const marked = withLoadFailures(src, [1, 2]);
  assert.deepEqual(marked.map((s) => s.failed), [false, true, true]);
  assert.equal(marked[0], src[0]);
  assert.equal(marked[2], src[2], 'already failed: unchanged');
  assert.equal(src[1]?.failed, false, 'the input is not changed');
});

test('every failure message key says the coins came back (ai:failure.*)', () => {
  for (const status of ['failed', 'blocked'] as const) {
    for (const code of [null, 'generation_failed', 'blocked:x', 'daily_budget_exceeded']) {
      const v = describeScene({ status, parent_scene_id: U1 }, job('failed', null, code));
      assert.match(v.failureKey ?? '', /^ai:failure\./);
    }
  }
});

// ---- Choices ------------------------------------------------------------------------------------------

const choices = [
  { id: 'a' as const, label: 'Open it', hint: 'Read it' },
  { id: 'b' as const, label: 'Follow', hint: '' },
  { id: 'c' as const, label: 'Run', hint: 'Away' },
];

test('choices: new and failed ones cost a scene; ready and working ones open for free; blocked ones can’t be taken', () => {
  const none = describeChoices(choices, [], 30);
  assert.deepEqual(none.map((c) => [c.state, c.cost, c.sceneId]), [['new', 30, null], ['new', 30, null], ['new', 30, null]]);
  const views = describeChoices(choices, [
    { id: U1, chosen_choice: 'a', status: 'ready' },
    { id: U2, chosen_choice: 'b', status: 'generating' },
    { id: U3, chosen_choice: 'c', status: 'blocked' },
  ], 30);
  assert.deepEqual(views.map((c) => [c.state, c.cost, c.sceneId]), [['ready', 0, U1], ['working', 0, U2], ['blocked', 0, U3]]);
  assert.deepEqual(describeChoices(choices, [{ id: U1, chosen_choice: 'a', status: 'failed' }], 25)[0]?.cost, 25);
  assert.deepEqual(describeChoices(choices, [{ id: U1, chosen_choice: 'a', status: 'queued' }], 25)[0]?.state, 'working');
});

test('after POST /choose: a blocked path stays put with a calm note, anything else opens', () => {
  assert.equal(chooseOutcome({ status: 'blocked' }), 'blocked');
  for (const status of ['ready', 'queued', 'generating', 'failed', undefined] as const) assert.equal(chooseOutcome({ status }), 'open');
});

test('new choices are asked for only while the story is active (unknown counts as open)', () => {
  assert.equal(storyTakesChoices(undefined), true);
  assert.equal(storyTakesChoices(null), true);
  assert.equal(storyTakesChoices('active'), true);
  for (const s of ['planning', 'completed', 'failed', 'blocked'] as const) assert.equal(storyTakesChoices(s), false, s);
});

// ---- The reader's stories ------------------------------------------------------------------------------

test('a story is listed by its title, else the start of its opening cut at a word', () => {
  assert.equal(storyListTitle({ title: ' Low Tide ', premise: 'whatever' }), 'Low Tide');
  assert.equal(storyListTitle({ title: null, premise: '  A short   opening line.  ' }), 'A short opening line.');
  const long = 'A lighthouse keeper finds a message in a bottle, sealed with wax, written in her own handwriting.';
  const cut = storyListTitle({ title: '', premise: long });
  assert.equal(cut, 'A lighthouse keeper finds a message in a bottle, sealed…');
  assert.ok((cut ?? '').length <= 61);
  assert.equal(storyListTitle({ title: null, premise: '   ' }), null);
  assert.equal(storyListTitle({ title: null, premise: 'x'.repeat(80) }), `${'x'.repeat(60)}…`, 'no space: a hard cut');
});

test('story statuses have list labels; an unknown one reads as in progress', () => {
  for (const s of ['planning', 'active', 'completed', 'failed', 'blocked'] as const) assert.equal(storyStatusKey(s), `story:list.status.${s}`);
  assert.equal(storyStatusKey('archived' as 'active'), 'story:list.status.active');
});

// ---- Playback -------------------------------------------------------------------------------------------

test('text appears on the scene clock: captions and dialogue lines of the panel showing', () => {
  const steps = revealPlan(demoManifest);
  const timeline = comicTimeline(demoManifest);
  assert.deepEqual(visibleText(steps, 1, -1), { caption: false, lines: [] });
  const end = visibleText(steps, 2, timeline.totalMs);
  assert.equal(end.caption, true);
  assert.deepEqual(end.lines, [0]);
  // Nothing from another panel leaks in.
  assert.deepEqual(visibleText(steps, 99, timeline.totalMs), { caption: false, lines: [] });
});

test('skip jumps to the next panel, and from the last panel to the end', () => {
  const timeline = comicTimeline(demoManifest);
  const [p1, p2] = timeline.panels;
  assert.equal(skipTarget(timeline, 0), p2?.startMs);
  assert.equal(skipTarget(timeline, (p1?.endMs ?? 0) - 1), p2?.startMs);
  const last = timeline.panels.at(-1);
  assert.equal(skipTarget(timeline, (last?.startMs ?? 0) + 1), timeline.totalMs);
  assert.equal(skipTarget(timeline, timeline.totalMs), timeline.totalMs);
});

test('the scene clock adds the running time to what was played, within the scene', () => {
  assert.equal(clockPosition(1000, null, 50_000, 9000), 1000, 'paused');
  assert.equal(clockPosition(1000, 50_000, 52_500, 9000), 3500);
  assert.equal(clockPosition(8000, 50_000, 60_000, 9000), 9000, 'never past the end');
  assert.equal(clockPosition(0, 50_000, 49_000, 9000), 0, 'a clock that went backwards counts as no time');
});

// ---- "How this scene was made" and route params ------------------------------------------------------------

test('pipeline steps and providers have names; unknown ones fall back', () => {
  assert.equal(taskKey('panels'), 'story:howMade.tasks.panels');
  assert.equal(taskKey('teleport'), 'story:howMade.tasks.unknown');
  assert.equal(providerKey('meta'), 'story:howMade.providers.meta');
  assert.equal(providerKey('acme'), null);
});

test('route params: only a single UUID is a story or scene id', () => {
  assert.equal(asUuid(U1.toUpperCase()), U1);
  assert.equal(asUuid([U1]), null);
  assert.equal(asUuid('../wallet'), null);
  assert.equal(asUuid(undefined), null);
});

// ---- Row checks ------------------------------------------------------------------------------------------

const jobRow = {
  id: U1, story_id: U2, scene_id: U3, kind: 'scene', lane: 'scene', status: 'running', progress: 'writing',
  error_code: null, created_at: '2026-10-29T08:00:00Z', finished_at: null,
};

test('rows of the wrong shape are refused whole, never half-shown', () => {
  assert.deepEqual(parseJobRow(jobRow), jobRow);
  assert.equal(parseJobRow({ ...jobRow, status: 'exploded' }), null);
  assert.equal(parseJobRow({ ...jobRow, id: 'nope' }), null);
  assert.deepEqual(parseRows([jobRow, jobRow], parseJobRow)?.length, 2);
  assert.equal(parseRows([jobRow, { ...jobRow, lane: 'x' }], parseJobRow), null);
  assert.equal(parseRows({ 0: jobRow }, parseJobRow), null);
  assert.equal(parseConsentRow({ user_id: U1, purpose: 'story', providers: ['meta'], version: AI_CONSENT_VERSION, accepted_at: 'x', withdrawn_at: null })?.purpose, 'story');
  assert.equal(parseSceneRow({ id: U1 }), null);
  assert.deepEqual(parseSceneHead({ id: U1, status: 'ready', created_at: 'x' }), { id: U1, status: 'ready', created_at: 'x' });
  assert.equal(parseSceneHead({ id: U1, status: 'lost', created_at: 'x' }), null);
  assert.equal(parseStoryRow(null), null);
});

test('"try another choice" goes back only when the screen below is the parent scene', () => {
  assert.equal(PLAYER_ROUTE, 'story/[id]');
  const routes = [
    { name: '(tabs)' },
    { name: 'story/[id]', params: { id: U1, scene: U2.toUpperCase() } },
    { name: 'story/[id]', params: { id: U1, scene: U3 } },
  ];
  assert.equal(sceneBelow({ index: 2, routes }), U2);
  assert.equal(sceneBelow({ index: 1, routes }), null, 'below is the tabs');
  assert.equal(sceneBelow({ index: 0, routes }), null);
  assert.equal(sceneBelow(undefined), null);
  assert.equal(sceneBelow({ index: 1, routes: [{ name: 'story/[id]', params: { id: U1 } }, routes[2]!] }), null, 'no scene param');
  assert.equal(sceneBelow({ index: 1, routes: [{ name: 'series/[slug]', params: { scene: U2 } }, routes[2]!] }), null);
});

test('a story opens at its newest scene that is drawn or being made, else its newest', () => {
  const at = (h: number) => `2026-10-29T0${h}:00:00+00:00`;
  assert.equal(sceneToOpen([]), null);
  assert.equal(sceneToOpen([
    { id: U1, status: 'ready', created_at: at(1) },
    { id: U3, status: 'blocked', created_at: at(3) },
    { id: U2, status: 'ready', created_at: at(2) },
  ]), U2);
  assert.equal(sceneToOpen([
    { id: U1, status: 'ready', created_at: at(1) },
    { id: U2, status: 'generating', created_at: at(2) },
  ]), U2, 'a scene being made shows its progress');
  assert.equal(sceneToOpen([
    { id: U1, status: 'failed', created_at: at(1) },
    { id: U2, status: 'blocked', created_at: at(2) },
  ]), U2, 'nothing drawn: the newest, which says what happened');
});

test('the player paces panels by reading time while it plays no narration audio', () => {
  assert.equal(readingPaced(demoManifest), demoManifest, 'no audio: unchanged');
  const voiced = { ...demoManifest, narration: { ...demoManifest.narration, audio: 'narration.mp3', duration_ms: 30_000 } };
  const paced = readingPaced(voiced);
  assert.equal(paced.narration.audio, null);
  assert.equal(paced.narration.duration_ms, null);
  assert.equal(paced.narration.text, demoManifest.narration.text);
  assert.equal(comicTimeline(paced).totalMs, comicTimeline(demoManifest).totalMs);
  assert.equal(voiced.narration.duration_ms, 30_000, 'the input is not changed');
});
