// Editor tools: the review queue, verdicts, takedowns, Editor's Pick, dismissing reports. The auth
// middleware has verified a signed-in adult; every request here also asks the database whether that
// account is an editor (roles aren't in the JWT, and a revoked editor must lose access at once).
// Anyone else gets the same bare 403 for every path, so the routes reveal nothing. The editor's id
// always comes from the token, never from the body.

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.ts';
import { serviceDb } from '../lib/db.ts';
import { dbErrorResponse, jsonError } from '../lib/http.ts';

export const editorRoutes = new Hono<AppContext>();

/** Re-crediting buyers after a takedown: rows per svc.recredit_episode call, calls per request. */
export const RECREDIT_PAGE_SIZE = 200;
export const RECREDIT_MAX_PAGES = 10;

editorRoutes.use('*', async (c, next) => {
  let role: string | null;
  try {
    role = await serviceDb(c.env).rpc<string | null>('editor_role', { p_user: c.get('userId') });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  if (role !== 'editor' && role !== 'admin') return jsonError(c, 403, 'forbidden');
  c.header('Cache-Control', 'private, no-store');
  await next();
});

const QueueQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

editorRoutes.get('/queue', async (c) => {
  const q = QueueQuery.safeParse({ limit: c.req.query('limit') });
  if (!q.success) return jsonError(c, 400, 'bad_request');
  try {
    return c.json(await serviceDb(c.env).rpc('editor_queue', { p_limit: q.data.limit }));
  } catch (err) {
    return dbErrorResponse(c, err);
  }
});

const VerdictBody = z.object({
  target: z.enum(['series', 'episode', 'series_edit', 'episode_edit']),
  id: z.string().uuid(),
  version: z.number().int().min(0),
  decision: z.enum(['approved', 'rejected']),
  categories: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(10).default([]),
  reason: z.string().trim().max(300).default(''),
});

// A first review or an edit review, decided by a person (the version is the one the editor saw).
// svc.editor_verdict records it through svc.record_verdict, and refuses the editor's own content.
editorRoutes.post('/verdict', async (c) => {
  const body = VerdictBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return jsonError(c, 400, 'bad_request');
  try {
    const outcome = await serviceDb(c.env).rpc<string>('editor_verdict', {
      p_target: body.data.target, p_id: body.data.id, p_version: body.data.version, p_decision: body.data.decision,
      p_categories: body.data.categories, p_reason: body.data.reason, p_editor: c.get('userId'),
    });
    return c.json({ outcome });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
});

const TakedownBody = z.object({
  target: z.enum(['series', 'episode']),
  id: z.string().uuid(),
  ground: z.enum(['legal', 'terms']),
  // The statement of reasons: which law or Terms clause, and the facts it rests on.
  reference: z.string().trim().min(1).max(200),
  facts: z.string().trim().min(1).max(2000),
  report_ids: z.array(z.number().int().positive()).max(100).default([]),
});

type TakedownResult = { outcome: 'removed' | 'already_removed'; recredit: string[]; reports_resolved: number };

// Take a series or an episode down, then give buyers their coins back, a bounded number of pages per
// request. `remaining` lists the episodes not finished yet: the client sends the same request again
// (the takedown itself is not repeated) until it is empty.
editorRoutes.post('/takedown', async (c) => {
  const body = TakedownBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return jsonError(c, 400, 'bad_request');
  const db = serviceDb(c.env);
  let r: TakedownResult;
  try {
    r = await db.rpc<TakedownResult>('take_down', {
      p_target: body.data.target, p_id: body.data.id, p_editor: c.get('userId'), p_ground: body.data.ground,
      p_reference: body.data.reference, p_facts: body.data.facts, p_report_ids: body.data.report_ids,
    });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  const remaining: string[] = [];
  let pages = 0;
  let failed = false;
  for (const episode of r.recredit ?? []) {
    let done = false;
    while (!done && !failed && pages < RECREDIT_MAX_PAGES) {
      pages++;
      try {
        const n = await db.rpc<number>('recredit_episode', { p_episode: episode, p_reason: 'moderation', p_limit: RECREDIT_PAGE_SIZE });
        // Only 0 means done: a short page can also mean a concurrent run (another request, a job with
        // another page size) took some of its buyers while more are still waiting.
        done = n === 0;
      } catch (err) {
        // Each buyer is re-credited once whatever happens, so the client can simply try again.
        console.error('recredit failed', err instanceof Error ? err.message : err);
        failed = true;
      }
    }
    if (!done) remaining.push(episode);
  }
  return c.json({ outcome: r.outcome, reports_resolved: r.reports_resolved, remaining });
});

const PickBody = z.object({
  series_id: z.string().uuid(),
  on: z.boolean(),
  note: z.string().trim().max(2000).optional(),
});

editorRoutes.post('/editors-pick', async (c) => {
  const body = PickBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return jsonError(c, 400, 'bad_request');
  try {
    const outcome = await serviceDb(c.env).rpc<string>('set_editors_pick', {
      p_series: body.data.series_id, p_on: body.data.on, p_editor: c.get('userId'), p_note: body.data.note ?? null,
    });
    return c.json({ outcome });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
});

const ReportId = z.string().regex(/^[1-9][0-9]{0,14}$/).transform(Number);
const DismissBody = z.object({ note: z.string().trim().max(2000).optional() });

editorRoutes.post('/reports/:id/dismiss', async (c) => {
  const id = ReportId.safeParse(c.req.param('id'));
  // The note is optional, and so is the body.
  const text = await c.req.text().catch(() => '');
  let json: unknown = {};
  try {
    json = text.trim() ? JSON.parse(text) : {};
  } catch {
    json = null;
  }
  const body = DismissBody.safeParse(json);
  if (!id.success || !body.success) return jsonError(c, 400, 'bad_request');
  try {
    const outcome = await serviceDb(c.env).rpc<string>('dismiss_report', {
      p_report: id.data, p_editor: c.get('userId'), p_note: body.data.note ?? null,
    });
    return c.json({ outcome });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
});
