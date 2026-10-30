import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, type TestDb } from './harness.ts';

let db: TestDb;
before(async () => {
  db = await freshDb({ seed: true });
});
after(async () => {
  await db.close();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const PREMISE = 'A lighthouse keeper finds letters from someone not born yet.';

async function storyteller(opts: { consent?: boolean; coins?: boolean } = {}) {
  const u = await db.createAdult(`ai-${uniq()}@example.com`);
  await db.asUser(u);
  if (opts.consent ?? true) await db.q(`select public.set_ai_consent('story', array['meta','google'], 'v1', true)`);
  if (opts.coins ?? true) {
    await db.asService();
    await db.q(`select svc.credit_purchase($1, $2, 'app_store', $3, 'reeltale.coins.525', 'production', 3675000)`, [u, `e-${uniq()}`, `t-${uniq()}`]);
  }
  return u;
}

const balance = async (u: string) => {
  await db.asUser(u);
  return (await db.one<{ w: { balance: number } }>('select public.get_my_wallet() as w')).w.balance;
};

type Start = { story_id: string; scene_id: string; job_id: string };
async function start(u: string): Promise<Start> {
  await db.asService();
  return (await db.one<{ r: Start }>(`select svc.ai_start_story($1, $2, array['mystery'], 'comic') as r`, [u, PREMISE])).r;
}

async function ready(job: string, ending = false) {
  await db.asService();
  await db.q(`select svc.ai_scene_ready($1, 'Low Tide', $2, 'ai/x/manifest.json', '{"title":"The Lighthouse Letters"}', '{}', '{}')`, [job, ending]);
}

test('starting a story needs consent and AI access, and holds 50 coins', async () => {
  const noConsent = await storyteller({ consent: false });
  await db.asService();
  await db.fails(`select svc.ai_start_story($1, $2, '{}', 'comic')`, [noConsent, PREMISE], /ai_consent_required/);
  const noMoney = await storyteller({ coins: false });
  await db.asService();
  await db.fails(`select svc.ai_start_story($1, $2, '{}', 'comic')`, [noMoney, PREMISE], /ai_access_required/);
  const u = await storyteller();
  await db.asService();
  await db.fails(`select svc.ai_start_story($1, $2, '{}', 'video')`, [u, PREMISE], /mode_unavailable/);
  await start(u);
  assert.equal(await balance(u), 475);
});

test('a finished scene captures the coins; choosing continues; the same choice twice is free', async () => {
  const u = await storyteller();
  const s = await start(u);
  await ready(s.job_id);
  assert.equal(await balance(u), 475);
  await db.asService();
  const c1 = (await db.one<{ r: Start & { existing: boolean } }>(`select svc.ai_choose($1, $2, 'b') as r`, [u, s.scene_id])).r;
  const c2 = (await db.one<{ r: Start & { existing: boolean } }>(`select svc.ai_choose($1, $2, 'b') as r`, [u, s.scene_id])).r;
  assert.equal(c1.scene_id, c2.scene_id);
  assert.equal(c2.existing, true);
  assert.equal(await balance(u), 445, 'charged once for the repeated choice');
  await db.asUser(u);
  const scenes = await db.q<{ depth: number }>('select depth from public.ai_scenes where story_id = $1 order by depth', [s.story_id]);
  assert.deepEqual(scenes.map((r) => r.depth), [1, 2]);
});

test('a failed or blocked scene refunds; a blocked first scene blocks the story', async () => {
  const u = await storyteller();
  const s = await start(u);
  await db.asService();
  await db.q(`select svc.ai_job_failed($1, 'content_policy', true)`, [s.job_id]);
  assert.equal(await balance(u), 525);
  await db.asUser(u);
  assert.equal((await db.one<{ s: string }>('select status as s from public.ai_stories where id = $1', [s.story_id])).s, 'blocked');
  await db.asService();
  assert.equal((await db.one<{ r: { status: string } }>(`select svc.ai_job_failed($1, 'x', false) as r`, [s.job_id])).r.status, 'already_finished');
  await db.fails(`select svc.ai_scene_ready($1, 't', false, 'k', null, null, null)`, [s.job_id], /job_already_failed/);
  assert.equal(await balance(u), 525, 'no double refund');
});

test('a failed choice can be retried (and is charged again); a blocked one cannot; one scene at a time', async () => {
  const u = await storyteller();
  const s = await start(u);
  await ready(s.job_id);
  type Chosen = Start & { existing: boolean; status: string };
  const choose = async (c: string) => {
    await db.asService();
    return (await db.one<{ r: Chosen }>(`select svc.ai_choose($1, $2, $3) as r`, [u, s.scene_id, c])).r;
  };
  const a1 = await choose('a');
  assert.equal(await balance(u), 445);
  await db.asService();
  await db.fails(`select svc.ai_choose($1, $2, 'b')`, [u, s.scene_id], /scene_in_progress/);
  await db.q(`select svc.ai_job_failed($1, 'generation_failed', false)`, [a1.job_id]);
  assert.equal(await balance(u), 475, 'refunded');

  const a2 = await choose('a');
  assert.equal(a2.existing, false);
  assert.equal(a2.scene_id, a1.scene_id, 'same scene, new job');
  assert.notEqual(a2.job_id, a1.job_id);
  assert.equal(await balance(u), 445, 'the retry is charged');
  await db.asService();
  const ctx = (await db.one<{ c: { scene: { id: string } } }>('select svc.ai_job_context($1) as c', [a2.job_id])).c;
  assert.equal(ctx.scene.id, a1.scene_id);
  await db.q(`select svc.ai_job_failed($1, 'blocked:sexual', true)`, [a2.job_id]);
  assert.equal(await balance(u), 475);

  const a3 = await choose('a');
  assert.equal(a3.existing, true);
  assert.equal(a3.status, 'blocked');
  assert.equal(await balance(u), 475, 'a blocked choice is not retried or charged');
  const b = await choose('b');
  assert.equal(b.existing, false);
  assert.equal(await balance(u), 445);
});

test('reservations: idempotent per step, capped per job and per day', async () => {
  const u = await storyteller();
  const s = await start(u);
  await db.asService();
  await db.q(`select svc.ai_reserve($1, 'plan', 60000)`, [s.job_id]);
  await db.q(`select svc.ai_reserve($1, 'plan', 60000)`, [s.job_id]);
  const spent = await db.one<{ n: number }>('select spent_micros as n from public.ai_jobs where id = $1', [s.job_id]);
  assert.equal(spent.n, 60000, 'a retried step reserves once');
  await db.fails(`select svc.ai_reserve($1, 'huge', 10000000)`, [s.job_id], /job_budget_exceeded/);
  await db.asPostgres();
  await db.q(`update public.pricing_config set value = '70000' where key = 'ai_daily_cap_micros'`);
  await db.asService();
  await db.fails(`select svc.ai_reserve($1, 'panel:1', 20000)`, [s.job_id], /daily_budget_exceeded/);
  await db.asPostgres();
  await db.q(`update public.pricing_config set value = '20000000' where key = 'ai_daily_cap_micros'`);
});

test('one running scene per story; stale jobs are swept and refunded', async () => {
  const u = await storyteller();
  const s = await start(u);
  await db.asService();
  await db.q(`select svc.ai_reserve($1, 'plan', 1000)`, [s.job_id]);
  await db.asPostgres();
  await db.q(`update public.ai_jobs set heartbeat_at = now() - interval '1 hour' where id = $1`, [s.job_id]);
  await db.asService();
  assert.ok((await db.one<{ n: number }>('select svc.ai_sweep_stale(15) as n')).n >= 1);
  assert.equal(await balance(u), 525);
});

test('scenes cannot be continued by others or after the ending', async () => {
  const u = await storyteller();
  const other = await storyteller();
  const s = await start(u);
  await ready(s.job_id, true);
  await db.asService();
  await db.fails(`select svc.ai_choose($1, $2, 'a')`, [other, s.scene_id], /scene_not_found/);
  await db.fails(`select svc.ai_choose($1, $2, 'a')`, [u, s.scene_id], /scene_not_continuable/);
  await db.fails(`select svc.ai_choose($1, $2, 'z')`, [u, s.scene_id], /invalid_choice/);
});

test('manifests are readable only by the story owner, once ready', async () => {
  const u = await storyteller();
  const other = await storyteller();
  const s = await start(u);
  await db.asService();
  assert.equal((await db.one<{ r: { allowed: boolean } }>('select svc.ai_scene_access($1, $2) as r', [u, s.scene_id])).r.allowed, false);
  await ready(s.job_id);
  assert.equal((await db.one<{ r: { manifest_key: string } }>('select svc.ai_scene_access($1, $2) as r', [u, s.scene_id])).r.manifest_key, 'ai/x/manifest.json');
  assert.equal((await db.one<{ r: { allowed: boolean } }>('select svc.ai_scene_access($1, $2) as r', [other, s.scene_id])).r.allowed, false);
  await db.asUser(other);
  assert.equal((await db.q('select id from public.ai_stories where id = $1', [s.story_id])).length, 0);
});

test('the generation log is append-only and the job context has the path', async () => {
  const u = await storyteller();
  const s = await start(u);
  await db.asService();
  await db.q(`select svc.ai_log_generation($1, 'plan', 'meta', 'muse-wonder-1.0', 60000, 4200, true, null, null, '2026-10-27.1')`, [s.job_id]);
  await ready(s.job_id);
  await db.asService();
  const child = (await db.one<{ r: Start }>(`select svc.ai_choose($1, $2, 'a') as r`, [u, s.scene_id])).r;
  const c = (await db.one<{ r: { story: { premise: string }; path: { scene_id: string }[]; scene: { chosen_choice: string } } }>(
    'select svc.ai_job_context($1) as r', [child.job_id])).r;
  assert.equal(c.story.premise, PREMISE);
  assert.deepEqual(c.path.map((x) => x.scene_id), [s.scene_id]);
  assert.equal(c.scene.chosen_choice, 'a');
  await db.asPostgres();
  await db.fails('update app_private.ai_generations set cost_micros = 0', [], /append-only/);
});

test('a retried start with the same request id returns the same story and charges once', async () => {
  const u = await storyteller();
  const rid = crypto.randomUUID();
  const startWith = async (id: string) => {
    await db.asService();
    return (await db.one<{ r: Start & { existing: boolean } }>(
      `select svc.ai_start_story($1, $2, array['mystery'], 'comic', $3) as r`, [u, PREMISE, id])).r;
  };
  const a = await startWith(rid);
  const b = await startWith(rid);
  assert.equal(a.existing, false);
  assert.equal(b.existing, true);
  assert.deepEqual([b.story_id, b.scene_id, b.job_id], [a.story_id, a.scene_id, a.job_id]);
  assert.equal(await balance(u), 475, 'held once');
  const c = await startWith(crypto.randomUUID());
  assert.notEqual(c.story_id, a.story_id);
  assert.equal(await balance(u), 425);
  // Another user's request id never matches.
  const v = await storyteller();
  await db.asService();
  const other = (await db.one<{ r: Start & { existing: boolean } }>(
    `select svc.ai_start_story($1, $2, array['mystery'], 'comic', $3) as r`, [v, PREMISE, rid])).r;
  assert.equal(other.existing, false);
});
