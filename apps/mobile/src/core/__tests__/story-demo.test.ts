import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryManifestSchema } from '@reeltale/shared';
import { ApiError } from '../api.ts';
import { describeJob } from '../jobs.ts';
import { DEMO_PANEL_KEYS, DEMO_SCENE_ID, DEMO_STORY_ID } from '../../demo/fixtures.ts';
import {
  buildDemoManifest, DEMO_BLOCKED_PATH, DEMO_SCENE_A_ID, DEMO_SCENE_C_ID, demoFixtureScenes, demoTemplate,
} from '../../features/story/demo.ts';
import {
  DEMO_QUEUED_MS, DEMO_STEP_MS, demoChildren, demoChoose, demoJobDuration, demoLatestSceneId, demoManifestFor,
  demoSceneState, demoStart, demoStoryById, demoStoryList, initialDemoStories, type DemoStoryState,
} from '../../features/story/demoEngine.ts';
import { describeChoices, describeScene, taskKey } from '../../features/story/logic.ts';

// Demo mode's AI stories (src/features/story/demo.ts + demoEngine.ts): every fixture scene is a valid
// manifest, and the engine behaves like the Worker and svc.ai_* do (idempotent starts, existing choices
// returned at once, blocked paths, one scene at a time, a completed story takes no new paths).

const PATHS = ['', 'a', 'b', 'aa', 'ab', 'ac', 'ba', 'bb', 'bc'];
const T0 = Date.parse('2026-10-30T09:00:00Z');
const STORY = '5a000000-0000-4000-8000-000000000001';
const SCENE = '5b000000-0000-4000-8000-000000000001';

function ids() {
  let n = 0;
  return () => `ee000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError);
    return err.code;
  }
  return 'no error';
};

test('every demo scene is a valid manifest: four bundled panels, three choices or an ending, AI-labelled', () => {
  for (const path of PATHS) {
    const m = buildDemoManifest(STORY, SCENE, path, '2026-10-30T09:00:00Z');
    assert.ok(m, path);
    const r = StoryManifestSchema.safeParse(m);
    assert.ok(r.success, `${path}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
    assert.equal(m.panels.length, 4);
    for (const p of m.panels) assert.ok(DEMO_PANEL_KEYS.includes(p.image), p.image);
    assert.equal(m.is_ending, path.length === 2);
    assert.equal(m.choices.length, m.is_ending ? 0 : 3);
    assert.equal(m.provenance.ai_generated, true);
    for (const model of m.provenance.models) assert.notEqual(taskKey(model.task), 'story:howMade.tasks.unknown', model.task);
    assert.equal(m.provenance.models.some((x) => x.task === 'plan'), path === '', 'only the opening plans the story');
  }
});

test('the demo tree: one path is blocked, nothing goes past an ending, odd paths have no scene', () => {
  assert.equal(demoTemplate(DEMO_BLOCKED_PATH), 'blocked');
  assert.equal(buildDemoManifest(STORY, SCENE, DEMO_BLOCKED_PATH, 'x'), null);
  for (const path of ['ca', 'aaa', 'd', 'A', '../']) assert.equal(demoTemplate(path), null, path);
});

test('the fixture story starts with its opening read, path a drawn and path c blocked', () => {
  const state = initialDemoStories();
  const now = T0;
  assert.equal(demoStoryList(state, now)[0]?.id, DEMO_STORY_ID);
  assert.equal(demoStoryById(state, DEMO_STORY_ID, now).status, 'active');
  assert.equal(demoSceneState(state, DEMO_SCENE_ID, now).scene.status, 'ready');
  const children = demoChildren(state, DEMO_SCENE_ID, now);
  assert.deepEqual(children.map((c) => [c.chosen_choice, c.status]).sort(), [['a', 'ready'], ['c', 'blocked']]);
  assert.equal(demoFixtureScenes.length, 3);
  assert.equal(demoLatestSceneId(state, DEMO_STORY_ID, now), DEMO_SCENE_A_ID, 'the newest scene that was drawn, not the blocked one');
  const views = describeChoices(buildDemoManifest(DEMO_STORY_ID, DEMO_SCENE_ID, '', 'x')!.choices, children, 30);
  assert.deepEqual(views.map((v) => v.state), ['ready', 'new', 'blocked']);
  // The opening's manifest is the shared fixture scene, under the fixture ids.
  const m = demoManifestFor(state, DEMO_SCENE_ID, now);
  assert.equal(m.scene_id, DEMO_SCENE_ID);
  assert.equal(m.title, 'The Bottle');
  assert.equal(demoManifestFor(state, DEMO_SCENE_A_ID, now).title, 'The Letter');
  assert.equal(code(() => demoManifestFor(state, DEMO_SCENE_C_ID, now)), 'not_available');
  assert.equal(code(() => demoSceneState(state, STORY, now)), 'scene_not_found');
});

test('starting a story charges once; the same request id returns the same story for free', () => {
  const newId = ids();
  const input = { premise: '  A night train stops at a station that isn’t on any map.  ', tags: ['mystery'], requestId: 'req-1', price: 50 };
  const first = demoStart(initialDemoStories(), input, T0, newId);
  assert.equal(first.charged, 50);
  assert.equal(first.started.existing, false);
  const story = demoStoryById(first.state, first.started.story_id, T0);
  assert.equal(story.premise, input.premise.trim());
  assert.equal(story.status, 'planning');
  assert.equal(demoStoryList(first.state, T0 + 1)[0]?.id, first.started.story_id, 'newest first');

  const again = demoStart(first.state, input, T0 + 5000, newId);
  assert.equal(again.charged, 0);
  assert.equal(again.started.existing, true);
  assert.equal(again.started.story_id, first.started.story_id);
  assert.equal(again.started.scene_id, first.started.scene_id);
  assert.equal(again.started.job_id, first.started.job_id);
  assert.equal(again.state.stories.length, first.state.stories.length);
});

test('a demo job walks through every progress step, and the bar never goes backwards', () => {
  const r = demoStart(initialDemoStories(), { premise: 'x'.repeat(30), tags: [], requestId: 'r', price: 50 }, T0, ids());
  const sceneId = r.started.scene_id;
  const total = demoJobDuration('story_start');
  assert.equal(total, DEMO_QUEUED_MS + 6 * DEMO_STEP_MS);
  const seen: string[] = [];
  let last = -1;
  for (let t = 0; t <= total + DEMO_STEP_MS; t += 100) {
    const { scene, job } = demoSceneState(r.state, sceneId, T0 + t);
    const view = describeScene(scene, job);
    assert.ok(view.job.fraction >= last, `at ${t} ms`);
    last = view.job.fraction;
    if (!seen.includes(view.job.key)) seen.push(view.job.key);
    if (t >= total) assert.equal(view.phase, 'ready');
    else assert.equal(view.polling, true);
  }
  assert.deepEqual(seen, [
    'ai:progress.queued', 'ai:progress.planning', 'ai:progress.casting', 'ai:progress.writing',
    'ai:progress.drawing', 'ai:progress.checking', 'ai:progress.framing', 'ai:progress.ready',
  ]);
  assert.equal(demoStoryById(r.state, r.started.story_id, T0 + total).status, 'active');
  assert.equal(demoStoryById(r.state, r.started.story_id, T0 + total).title, null, 'listed by its opening, not as a second Low Tide');
  assert.equal(demoLatestSceneId(r.state, r.started.story_id, T0), sceneId, 'still being made: opens the progress');
  assert.equal(code(() => demoManifestFor(r.state, sceneId, T0)), 'not_available', 'no manifest before it is ready');
  assert.equal(demoManifestFor(r.state, sceneId, T0 + total).scene_id, sceneId);
});

test('choosing: existing scenes come back at once and free, a new one costs a scene, one at a time', () => {
  const newId = ids();
  let state: DemoStoryState = initialDemoStories();
  const ready = demoChoose(state, { sceneId: DEMO_SCENE_ID, choice: 'a', price: 30 }, T0, newId);
  assert.deepEqual([ready.charged, ready.started.existing, ready.started.status, ready.started.scene_id], [0, true, 'ready', DEMO_SCENE_A_ID]);
  const blocked = demoChoose(state, { sceneId: DEMO_SCENE_ID, choice: 'c', price: 30 }, T0, newId);
  assert.deepEqual([blocked.charged, blocked.started.status], [0, 'blocked']);

  const fresh = demoChoose(state, { sceneId: DEMO_SCENE_ID, choice: 'b', price: 30 }, T0, newId);
  assert.deepEqual([fresh.charged, fresh.started.existing, fresh.started.status], [30, false, 'queued']);
  state = fresh.state;
  assert.equal(code(() => demoChoose(state, { sceneId: DEMO_SCENE_A_ID, choice: 'a', price: 30 }, T0 + 10, newId)), 'scene_in_progress');
  const while_ = demoChoose(state, { sceneId: DEMO_SCENE_ID, choice: 'b', price: 30 }, T0 + 10, newId);
  assert.deepEqual([while_.charged, while_.started.existing, while_.started.status], [0, true, 'queued'], 'the same choice again: no second charge');

  const done = T0 + demoJobDuration('scene');
  const b = demoSceneState(state, fresh.started.scene_id, done);
  assert.equal(b.scene.status, 'ready');
  assert.equal(b.scene.depth, 2);
  assert.equal(demoManifestFor(state, fresh.started.scene_id, done).title, 'Footprints');
});

test('reaching an ending completes the story, and then no scene takes a new path', () => {
  const newId = ids();
  let state: DemoStoryState = initialDemoStories();
  const ending = demoChoose(state, { sceneId: DEMO_SCENE_A_ID, choice: 'b', price: 30 }, T0, newId);
  state = ending.state;
  const done = T0 + demoJobDuration('scene');
  const scene = demoSceneState(state, ending.started.scene_id, done).scene;
  assert.equal(scene.is_ending, true);
  assert.equal(demoStoryById(state, DEMO_STORY_ID, done).status, 'completed');
  assert.equal(demoManifestFor(state, ending.started.scene_id, done).choices.length, 0);
  assert.equal(code(() => demoChoose(state, { sceneId: ending.started.scene_id, choice: 'a', price: 30 }, done, newId)), 'scene_not_continuable');
  assert.equal(code(() => demoChoose(state, { sceneId: DEMO_SCENE_ID, choice: 'b', price: 30 }, done, newId)), 'scene_not_continuable');
  assert.equal(code(() => demoChoose(state, { sceneId: STORY, choice: 'a', price: 30 }, done, newId)), 'scene_not_found');
});

test('a sample story’s blocked path runs, ends blocked, charges nothing and offers another choice', () => {
  const newId = ids();
  const started = demoStart(initialDemoStories(), { premise: 'x'.repeat(30), tags: [], requestId: 'r', price: 50 }, T0, newId);
  const t1 = T0 + demoJobDuration('story_start');
  const c = demoChoose(started.state, { sceneId: started.started.scene_id, choice: 'c', price: 30 }, t1, newId);
  assert.equal(c.charged, 0);
  const t2 = t1 + demoJobDuration('scene');
  const { scene, job } = demoSceneState(c.state, c.started.scene_id, t2);
  assert.equal(scene.status, 'blocked');
  assert.equal(job?.error_code, 'blocked:demo');
  const view = describeScene(scene, job);
  assert.equal(view.phase, 'blocked');
  assert.equal(view.failureKey, 'ai:failure.blocked');
  assert.deepEqual(view.actions, ['tryAnother']);
  // Chosen again: it comes back blocked at once.
  const again = demoChoose(c.state, { sceneId: started.started.scene_id, choice: 'c', price: 30 }, t2, newId);
  assert.deepEqual([again.charged, again.started.status], [0, 'blocked']);
  assert.equal(describeJob(job!).finished, true);
});
