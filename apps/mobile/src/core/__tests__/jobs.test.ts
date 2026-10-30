import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeJob, JOB_KEYS, JOB_STEPS, jobFailureKey, stepsFor, type JobRow } from '../jobs.ts';

const row = (over: Partial<JobRow> = {}): JobRow => ({ status: 'running', progress: null, error_code: null, ...over });

test('a first scene goes through all seven steps; later scenes skip planning and casting', () => {
  assert.deepEqual(stepsFor('story_start'), ['planning', 'casting', 'writing', 'drawing', 'checking', 'framing', 'ready']);
  assert.deepEqual(stepsFor('scene'), ['writing', 'drawing', 'checking', 'framing', 'ready']);
  assert.deepEqual(JOB_STEPS, ['planning', 'casting', 'writing', 'drawing', 'checking', 'framing', 'ready']);
});

test('a queued job with no progress yet', () => {
  assert.deepEqual(describeJob(row({ status: 'queued' })), {
    phase: 'queued', key: 'ai:progress.queued', step: null, fraction: 0.02, failureKey: null, finished: false,
  });
});

test('a running job shows its current step', () => {
  const v = describeJob(row({ progress: 'drawing' }), 'scene');
  assert.equal(v.phase, 'running');
  assert.equal(v.key, 'ai:progress.drawing');
  assert.equal(v.step, 'drawing');
  assert.equal(v.finished, false);
  assert.equal(v.failureKey, null);
  assert.equal(describeJob(row({ progress: 'planning' }), 'story_start').key, 'ai:progress.planning');
  assert.equal(describeJob(row({ progress: 'casting' }), 'story_start').step, 'casting');
});

test('the bar only moves forward as steps advance, and stays below 1 until the job has succeeded', () => {
  for (const kind of ['story_start', 'scene'] as const) {
    let last = describeJob(row({ status: 'queued' }), kind).fraction;
    for (const step of stepsFor(kind)) {
      const v = describeJob(row({ progress: step }), kind);
      assert.ok(v.fraction > last, `${kind} ${step}: ${v.fraction} should be above ${last}`);
      assert.ok(v.fraction < 1);
      last = v.fraction;
    }
    const done = describeJob(row({ status: 'succeeded', progress: 'ready' }), kind);
    assert.ok(done.fraction > last);
    assert.equal(done.fraction, 1);
  }
});

test('a succeeded job is ready and finished', () => {
  assert.deepEqual(describeJob(row({ status: 'succeeded', progress: 'ready' })), {
    phase: 'ready', key: 'ai:progress.ready', step: 'ready', fraction: 1, failureKey: null, finished: true,
  });
  // Whatever progress says, success is success.
  assert.equal(describeJob(row({ status: 'succeeded', progress: null })).phase, 'ready');
});

test('a failed job says why, and a blocked one is told apart (both are refunded)', () => {
  const failed = describeJob(row({ status: 'failed', progress: 'drawing', error_code: 'generation_failed' }));
  assert.deepEqual(failed, { phase: 'failed', key: 'ai:progress.failed', step: null, fraction: 0, failureKey: 'ai:failure.failed', finished: true });
  const blocked = describeJob(row({ status: 'failed', progress: 'checking', error_code: 'blocked:apparent_minor' }));
  assert.deepEqual(blocked, { phase: 'blocked', key: 'ai:progress.blocked', step: null, fraction: 0, failureKey: 'ai:failure.blocked', finished: true });
  assert.equal(describeJob(row({ status: 'failed', error_code: 'blocked:policy' })).phase, 'blocked');
  assert.equal(describeJob(row({ status: 'failed', error_code: null })).failureKey, 'ai:failure.failed');
});

test('the blocked reason is never put on screen', () => {
  const v = describeJob(row({ status: 'failed', error_code: 'blocked:apparent_minor' }));
  assert.ok(!JSON.stringify(v).includes('minor'));
  assert.ok(!JSON.stringify(v).includes('apparent'));
});

test('jobFailureKey covers every code the Worker stores', () => {
  assert.equal(jobFailureKey('blocked:sexual'), 'ai:failure.blocked');
  assert.equal(jobFailureKey('blocked:provider_policy'), 'ai:failure.blocked');
  assert.equal(jobFailureKey('daily_budget_exceeded'), 'ai:failure.paused');
  for (const code of ['generation_failed', 'launch_failed', 'stale', 'job_budget_exceeded', 'job_not_running', 'meta_not_configured', 'story_not_planned', 'who_knows', '', null, undefined]) {
    assert.equal(jobFailureKey(code), 'ai:failure.failed', String(code));
  }
});

test('an unknown step name keeps the job running with a neutral label', () => {
  const v = describeJob(row({ progress: 'translating' }));
  assert.equal(v.phase, 'running');
  assert.equal(v.key, 'ai:progress.working');
  assert.equal(v.step, null);
  // A step that doesn't apply to this kind of job (planning on a later scene) is treated the same.
  assert.equal(describeJob(row({ progress: 'planning' }), 'scene').key, 'ai:progress.working');
  // Running with no progress yet is working, not queued.
  assert.equal(describeJob(row({ status: 'running', progress: null })).key, 'ai:progress.working');
});

test('every key describeJob can return is declared in JOB_KEYS', () => {
  const rows: JobRow[] = [
    row({ status: 'queued' }), row({ progress: 'nope' }), row({ status: 'succeeded', progress: 'ready' }),
    row({ status: 'failed', error_code: 'blocked:x' }), row({ status: 'failed', error_code: 'daily_budget_exceeded' }), row({ status: 'failed' }),
    ...JOB_STEPS.map((s) => row({ progress: s })),
  ];
  for (const r of rows) {
    const v = describeJob(r, 'story_start');
    assert.ok(JOB_KEYS.includes(v.key), v.key);
    if (v.failureKey) assert.ok(JOB_KEYS.includes(v.failureKey), v.failureKey);
  }
});
