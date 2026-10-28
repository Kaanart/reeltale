// ReelTale Worker app (routes). Order of handling:
//  1. /api/health, /api/webhooks/* (signature-checked, no user auth)
//  2. /api/* for signed-in adults (JWT verified locally against Supabase JWKS)
//  3. association files (/.well-known/*, /app-ads.txt)
//  4. /series/:slug share pages (web app + OpenGraph tags)
//  5. everything else: the Expo web build from static assets (SPA fallback)
// Every response gets security headers; HTML also gets a strict CSP.

import { Hono } from 'hono';
import type { AppContext, Env } from './env.ts';
import { AuthError, bearerToken, supabaseJwks, verifyUserJwt } from './lib/auth.ts';
import { htmlCsp, jsonError, withSecurityHeaders } from './lib/http.ts';
import { serviceDb } from './lib/db.ts';
import { revenueCatWebhook } from './webhooks/revenuecat.ts';
import { streamWebhook } from './webhooks/stream.ts';
import { userRoutes } from './routes/user.ts';
import { aiRoutes } from './routes/ai.ts';
import { reviewBatch } from './moderation/review.ts';
import { createMetaClient } from './ai/meta.ts';
import { ogTags, safeImageUrl, type ShareCard } from './web/share.ts';

const app = new Hono<AppContext>();

app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV }));

app.post('/api/webhooks/revenuecat', revenueCatWebhook);
app.post('/api/webhooks/stream', streamWebhook);

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
      return jsonError(c, err.reason === 'not_adult' ? 403 : 401, err.reason);
    }
    throw err;
  }
  await next();
});
app.route('/api', userRoutes);
app.route('/api/ai', aiRoutes);
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

/** Cron: automated text moderation. Does nothing until the database and the Meta key are configured. */
export async function scheduled(env: Env): Promise<void> {
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = await app.fetch(request, env, ctx);
    return withSecurityHeaders(res, htmlCsp(env.SUPABASE_URL, env.MEDIA_ORIGIN));
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;

export { app };
