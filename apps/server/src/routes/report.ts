// Public notice form (EU Digital Services Act, Art. 16): anyone can report content, signed in or not.
// Signed-in users report in the app through public.report_content; this route is for the web form and
// runs without user auth. Abuse guards: same-origin browsers only, Turnstile, a capped body, and a daily
// cap per sender in SQL, counted on a hash of the IP that changes every day (the address is never stored).
// The answer is the same whether or not the target exists, so the form can't be used to probe ids.

import type { Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.ts';
import { serviceDb } from '../lib/db.ts';
import { dbErrorResponse, jsonError, readCappedText } from '../lib/http.ts';
import { dailyIpHash } from '../lib/ip-hash.ts';
import { verifyTurnstile } from '../lib/turnstile.ts';

export const REPORT_REASONS = [
  'minor_safety', 'sexual_content', 'violence', 'hate_harassment', 'self_harm', 'spam_scam', 'copyright',
  'impersonation', 'ai_not_labelled', 'illegal_other', 'other',
] as const;

const MAX_BODY_BYTES = 16 * 1024;

const NoticeBody = z.object({
  target_type: z.enum(['series', 'episode', 'ai_scene', 'profile']),
  target_id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  // Art. 16(2)(a): a sufficiently substantiated explanation.
  details: z.string().trim().min(10).max(2000),
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().max(254).pipe(z.email()).optional(),
  // Art. 16(2)(d): the notifier confirms they believe the notice is accurate and complete.
  good_faith: z.literal(true),
  turnstile_token: z.string().min(10).max(4096),
})
  // Art. 16(2)(c): name and email, except for child sexual abuse reports, which may be anonymous.
  .refine((b) => b.reason === 'minor_safety' || (b.name !== undefined && b.email !== undefined));


export async function reportNotice(c: Context<AppContext>) {
  if (c.req.header('Origin') !== c.env.APP_ORIGIN) return jsonError(c, 403, 'web_only');
  const raw = await readCappedText(c.req.raw, MAX_BODY_BYTES).catch(() => '');
  if (raw === null) return jsonError(c, 413, 'too_large');
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* handled below */
  }
  const body = NoticeBody.safeParse(json);
  if (!body.success) return jsonError(c, 400, 'bad_request');
  if (!c.env.TURNSTILE_SECRET || !c.env.IP_HASH_SECRET) return jsonError(c, 503, 'not_configured');
  const ip = c.req.header('CF-Connecting-IP');
  const human = await verifyTurnstile({
    secret: c.env.TURNSTILE_SECRET, token: body.data.turnstile_token, remoteIp: ip ?? undefined, expectedAction: 'report',
  });
  if (!human) return jsonError(c, 403, 'turnstile_failed');
  try {
    // 'received' or 'not_reportable': the notifier gets the same answer either way.
    await serviceDb(c.env).rpc<string>('submit_notice', {
      p_target_type: body.data.target_type, p_target_id: body.data.target_id, p_reason: body.data.reason,
      p_details: body.data.details, p_notifier_name: body.data.name ?? null, p_notifier_email: body.data.email ?? null,
      p_ip_hash: await dailyIpHash(c.env.IP_HASH_SECRET, ip),
    });
  } catch (err) {
    return dbErrorResponse(c, err);
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ status: 'received' }, 202);
}
