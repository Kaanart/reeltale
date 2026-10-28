// AI story routes for signed-in adults. The database decides access, consent and coins; the Worker
// starts the Workflow and serves the private assets.

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.ts';
import { serviceDb } from '../lib/db.ts';
import { dbErrorResponse, jsonError } from '../lib/http.ts';

export const aiRoutes = new Hono<AppContext>();

type Started = { story_id: string; scene_id: string; job_id: string; existing?: boolean };

/** Start the Workflow for a job. If that fails, refund at once (the sweeper would do it later anyway). */
async function launch(c: { env: AppContext['Bindings'] }, jobId: string): Promise<boolean> {
  try {
    await c.env.STORY_SCENE.create({ id: jobId, params: { jobId } });
    return true;
  } catch (err) {
    // A retry of the same request finds the instance already created: that's fine.
    if (err instanceof Error && /already exists|duplicate/i.test(err.message)) return true;
    console.error('workflow create failed', err instanceof Error ? err.message : err);
    await serviceDb(c.env).rpc('ai_job_failed', { p_job: jobId, p_error_code: 'launch_failed', p_blocked: false }).catch(() => {});
    return false;
  }
}

const StartBody = z.object({
  premise: z.string().trim().min(20).max(1000),
  tags: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(10).default([]),
  mode: z.literal('comic').default('comic'),
});

aiRoutes.post('/stories', async (c) => {
  const body = StartBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return jsonError(c, 400, 'bad_request');
  let r: Started;
  try {
    r = await serviceDb(c.env).rpc<Started>('ai_start_story', {
      p_user: c.get('userId'), p_premise: body.data.premise, p_tags: body.data.tags, p_mode: body.data.mode,
    });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  if (!(await launch(c, r.job_id))) return jsonError(c, 503, 'generation_unavailable');
  return c.json(r, 202);
});

const ChooseBody = z.object({ choice: z.enum(['a', 'b', 'c']) });

aiRoutes.post('/scenes/:sceneId/choose', async (c) => {
  const scene = z.string().uuid().safeParse(c.req.param('sceneId'));
  const body = ChooseBody.safeParse(await c.req.json().catch(() => null));
  if (!scene.success || !body.success) return jsonError(c, 400, 'bad_request');
  let r: Started;
  try {
    r = await serviceDb(c.env).rpc<Started>('ai_choose', { p_user: c.get('userId'), p_parent_scene: scene.data, p_choice: body.data.choice });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  if (!r.existing && !(await launch(c, r.job_id))) return jsonError(c, 503, 'generation_unavailable');
  return c.json(r, 202);
});

async function sceneAccess(c: { env: AppContext['Bindings'] }, userId: string, sceneId: string) {
  return serviceDb(c.env).rpc<{ allowed: boolean; manifest_key?: string; reason?: string }>('ai_scene_access', { p_user: userId, p_scene: sceneId });
}

aiRoutes.get('/scenes/:sceneId/manifest', async (c) => {
  const scene = z.string().uuid().safeParse(c.req.param('sceneId'));
  if (!scene.success) return jsonError(c, 400, 'bad_request');
  let access: Awaited<ReturnType<typeof sceneAccess>>;
  try {
    access = await sceneAccess(c, c.get('userId'), scene.data);
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  if (!access.allowed || !access.manifest_key) return jsonError(c, 404, 'not_available');
  const obj = await c.env.AI_ASSETS.get(access.manifest_key);
  if (!obj) return jsonError(c, 404, 'not_available');
  c.header('Cache-Control', 'private, max-age=300');
  c.header('Content-Type', 'application/json');
  return c.body(await obj.text());
});

// Panel and plate images of a scene the user may read. Only these file names, only under that scene.
aiRoutes.get('/scenes/:sceneId/assets/:file', async (c) => {
  const scene = z.string().uuid().safeParse(c.req.param('sceneId'));
  const file = c.req.param('file');
  if (!scene.success || !/^(panel|plate)-[1-4]\.webp$/.test(file)) return jsonError(c, 400, 'bad_request');
  let access: Awaited<ReturnType<typeof sceneAccess>>;
  try {
    access = await sceneAccess(c, c.get('userId'), scene.data);
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  if (!access.allowed || !access.manifest_key) return jsonError(c, 404, 'not_available');
  // manifest_key is ai/<story>/<scene>/manifest.json; assets sit next to it.
  const key = access.manifest_key.replace(/manifest\.json$/, file);
  const obj = await c.env.AI_ASSETS.get(key);
  if (!obj) return jsonError(c, 404, 'not_available');
  c.header('Cache-Control', 'private, max-age=86400, immutable');
  c.header('Content-Type', 'image/webp');
  return c.body(obj.body);
});
