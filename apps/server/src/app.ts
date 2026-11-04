// ReelTale Worker app (routes). Order of handling:
//  1. /api/health, /api/webhooks/* (signature-checked, no user auth, not rate limited), POST /api/report
//     (public notice form: Origin + Turnstile, no user auth)
//  2. /api/* for signed-in adults (JWT verified locally against Supabase JWKS), rate limited per user
//     (src/lib/rate-limit.ts); failed auth is limited per client address
//  3. association files (/.well-known/*, /app-ads.txt)
//  4. /series/:slug share pages (web app + OpenGraph tags; the tag lookup is limited per client address)
//  5. everything else: the Expo web build from static assets (SPA fallback)
// Every response gets security headers; HTML also gets a strict CSP.

import { Hono } from 'hono';
import type { AppContext, Env } from './env.ts';
import { AuthError, bearerToken, supabaseJwks, verifyUserJwt } from './lib/auth.ts';
import { htmlCsp, jsonError, withSecurityHeaders } from './lib/http.ts';
import { serviceDb } from './lib/db.ts';
import { revenueCatWebhook } from './webhooks/revenuecat.ts';
import { streamWebhook, sweepIngest } from './webhooks/stream.ts';
import { userRoutes } from './routes/user.ts';
import { aiRoutes } from './routes/ai.ts';
import { voiceRoutes } from './routes/voice.ts';
import { editorRoutes } from './routes/editor.ts';
import { reportNotice } from './routes/report.ts';
import { reviewBatch } from './moderation/review.ts';
import { createMetaClient } from './ai/meta.ts';
import { ogTags, safeImageUrl, type ShareCard } from './web/share.ts';
import { aiRateLimit, ipUnderLimit, rateLimited, userRateLimit } from './lib/rate-limit.ts';
import { valueDueLots } from './ledger/fx-valuations.ts';
import { ecbRates, workerCache } from './lib/fx.ts';

const app = new Hono<AppContext>();

app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV }));

app.post('/api/webhooks/revenuecat', revenueCatWebhook);
app.post('/api/webhooks/stream', streamWebhook);
// The DSA notice form must work logged out. Only this exact route skips the auth below.
app.post('/api/report', reportNotice);

// Auth for everything else under /api.
app.use('/api/*', async (c, next) => {
  if (!c.env.SUPABASE_URL) return jsonError(c, 503, 'not_configured');
  try {
    const token = bearerToken(c.req.header('Authorization'));
    const user = await verifyUserJwt(token, {
      jwks: supabaseJwks(c.env.SUPABASE_URL),
      issuer: `${c.env.SUPABASE_URL}/auth/v1`,
    });
    c.set('userId', user.userId);
    c.set('userJwt', token as string);
  } catch (err) {
    if (err instanceof AuthError) {
      if (!(await ipUnderLimit(c, 'api'))) return rateLimited(c);
      return jsonError(c, err.reason === 'not_adult' ? 403 : 401, err.reason);
    }
    throw err;
  }
  await next();
});
app.use('/api/*', userRateLimit);
app.use('/api/ai/*', aiRateLimit);
app.route('/api', userRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/ai', voiceRoutes);
app.route('/api/editor', editorRoutes);
app.all('/api/*', (c) => jsonError(c, 404, 'not_found'));

// ---- Association files -------------------------------------------------------------------------
app.get('/.well-known/apple-app-site-association', (c) => {
  const appId = `${c.env.APPLE_TEAM_ID}.${c.env.IOS_BUNDLE_ID}`;
  c.header('Content-Type', 'application/json');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(JSON.stringify({
    applinks: {
      details: [{
        appIDs: [appId],
        components: [{ '/': '/series/*' }, { '/': '/watch/*' }, { '/': '/s/*' }, { '/': '/story/*' }],
      }],
    },
    webcredentials: { apps: [appId] },
  }));
});

app.get('/.well-known/assetlinks.json', (c) => {
  const fingerprints = c.env.ANDROID_CERT_SHA256.split(',').map((s) => s.trim()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: c.env.ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
  }]);
});

app.get('/app-ads.txt', (c) => {
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(`google.com, ${c.env.ADMOB_PUBLISHER_ID}, DIRECT, f08c47fec0942fa0\n`);
});

app.all('/.well-known/*', (c) => c.notFound());

// ---- Share pages ---------------------------------------------------------------------------------
app.get('/series/:slug', async (c) => {
  const slug = c.req.param('slug');
  const page = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)));
  if (!/^[a-z0-9-]{3,90}$/.test(slug) || !page.ok || !c.env.SUPABASE_SECRET_KEY) return page;
  // Over the per-address limit: the plain web app, without the database lookup for share tags.
  if (!(await ipUnderLimit(c, 'share'))) return page;
  let card: ShareCard | null = null;
  try {
    const row = await serviceDb(c.env).rpc<{ title: string; synopsis: string; cover_key: string | null } | null>(
      'series_share_card', { p_slug: slug });
    if (row) {
      card = {
        title: row.title,
        description: row.synopsis,
        image: safeImageUrl(row.cover_key, c.env.MEDIA_ORIGIN),
        url: `${c.env.APP_ORIGIN}/series/${slug}`,
      };
    }
  } catch (err) {
    console.error('share card failed', err instanceof Error ? err.message : err);
  }
  if (!card) return page;
  const tags = ogTags(card);
  return new HTMLRewriter()
    .on('head', { element: (el) => { el.append(tags, { html: true }); } })
    .transform(page);
});

// ---- Static web app ------------------------------------------------------------------------------
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error('unhandled', err instanceof Error ? err.message : err);
  return jsonError(c, 500, 'internal_error');
});

/** Cron step: automated text moderation. Does nothing until the database and the Meta key are configured. */
async function moderationCron(env: Env): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.META_API_KEY) {
    console.warn('moderation cron skipped: not configured');
    return;
  }
  const db = serviceDb(env);
  const summary = await reviewBatch({
    rpc: (fn, args) => db.rpc(fn, args),
    meta: createMetaClient({ apiKey: env.META_API_KEY, endUserId: 'reeltale-moderation' }),
    log: (m) => console.error(m),
  });
  if (summary.failed) console.error('moderation cron', JSON.stringify(summary));
}

/**
 * Cron step: backstop for lost Stream webhooks and stopped runs. Uploads waiting for their first review
 * get their ingest workflow (or an editor). Needs only the database: without the Meta key the workflow
 * hands the upload to an editor, which still beats leaving it pending with nobody looking.
 */
async function ingestCron(env: Env, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.warn('ingest sweep skipped: not configured');
    return;
  }
  await sweepIngest(env, serviceDb(env, fetchImpl));
}

/** Cron step: euro values for non-EUR coins (src/ledger/fx-valuations.ts). Needs only the database. */
async function fxCron(env: Env, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.warn('fx cron skipped: not configured');
    return;
  }
  const db = serviceDb(env, fetchImpl);
  const summary = await valueDueLots({
    rpc: (fn, args) => db.rpc(fn, args),
    fx: ecbRates({ fetchImpl, cache: workerCache(), cacheKeyBase: env.APP_ORIGIN }),
    log: (m) => console.error(m),
  });
  if (summary.failed) console.error('fx cron', JSON.stringify(summary));
}

/**
 * Cron: moderation on every tick; FX valuation at most hourly, on the tick at minute 0 (an "every n
 * minutes" schedule always has one). Without a scheduled time (direct calls) only moderation runs. Both
 * steps always run; the first failure is rethrown afterwards so the cron's status shows it.
 */
export async function scheduled(env: Env, scheduledTime?: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  const steps = [moderationCron(env), ingestCron(env, fetchImpl)];
  if (scheduledTime !== undefined && new Date(scheduledTime).getUTCMinutes() === 0) steps.push(fxCron(env, fetchImpl));
  const failed = (await Promise.allSettled(steps)).find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = await app.fetch(request, env, ctx);
    return withSecurityHeaders(res, htmlCsp(env.SUPABASE_URL, env.MEDIA_ORIGIN));
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduled(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;

export { app };
