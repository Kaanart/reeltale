# ReelTale: runbook

How to configure, deploy and check things. Nothing here is a secret; secret values live only in the
Cloudflare dashboard / `wrangler secret`, Supabase, EAS env and Kaan's password manager.

## Go live for judging (target: Nov 3, submission Nov 4 21:00 EST)
Do these in order. Steps marked **Kaan** need your accounts or logins; send Claude the non-secret values
(project ref, URLs, publishable key, site key) in chat, never secrets.

1. **Kaan, Supabase:** create org `ReelTale` (Pro) → project `reeltale`, region EU Frankfurt. Save the DB password
   in your password manager. Send the project ref and the publishable key (`sb_publishable_…`; it is public).
2. **Kaan, terminal:** `npx supabase login`, then in the repo root:
   `npx supabase link --project-ref <ref>` and `npx supabase db push`. Paste the output to Claude.
   Then seed the tags: paste `supabase/seeds/10_tags.sql` into the dashboard's SQL editor and run it.
3. **Kaan, Supabase dashboard:**
   - Settings → API → Exposed schemas: add `svc`.
   - Authentication → Hooks → Custom Access Token → `public.custom_access_token_hook`.
   - Authentication → Providers: Email on (OTP). Without Resend set up, Supabase's own mail is rate limited to a few
     emails an hour: fine for judging, because judges use the password demo accounts (step 9).
4. **Kaan, terminal:** `npx wrangler login`, then:
   `npx wrangler r2 bucket create reeltale-ai --jurisdiction eu` and
   `npx wrangler r2 bucket create reeltale-media --jurisdiction eu`.
   (Staging buckets only if we deploy staging; for the hackathon we don't.)
5. **Kaan, secrets** (from `apps/server`, each asks for the value; never paste them in chat):
   `npx wrangler secret put SUPABASE_SECRET_KEY` (Supabase → Settings → API keys → secret key),
   `npx wrangler secret put META_API_KEY`, `npx wrangler secret put IP_HASH_SECRET` (any long random string, e.g.
   `openssl rand -hex 32`), `npx wrangler secret put TURNSTILE_SECRET` (Cloudflare → Turnstile → widget for
   reeltale.net). Stream secrets only if we show uploaded videos (see 8).
6. **Claude:** fills `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` in `apps/server/wrangler.jsonc` and documents the
   Workers Builds build variables.
7. **Kaan, Cloudflare dashboard → Workers → reeltale → Settings → Build → Variables:** `EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_KEY` (the publishable key), `EXPO_PUBLIC_TURNSTILE_SITE_KEY`. Without them the site builds in
   demo mode. Then Claude asks before the first push to `main` (= production deploy).
8. **Videos: skipped for judging** (footage not ready, Nov 1). No Stream setup needed. The site shows AI stories
   live, and the video catalog only in demo mode ("Explore the demo").
9. **Kaan, judge accounts** (Supabase → Authentication → Users → Add user → "Create new user", tick "Auto confirm"):
   create `judge1@reeltale.net` … `judge5@reeltale.net` (or your own addresses) with long random passwords from your
   password manager. Then in the SQL editor, for each user id (Claude prepares the exact SQL once the project exists):
   adult date of birth, Terms accepted, AI story consent, and an access code with coins + AI access days:
   ```sql
   insert into app_private.access_codes (code, coins, coins_expire_at, ai_days, max_redemptions, valid_until, note)
   values ('<LONG-RANDOM-CODE>', 1500, '2026-11-30', 30, 50, '2026-11-20', 'hackathon judges');
   ```
   The code goes in the submission form for judges (never in the app). Judges sign in with the password link,
   then redeem on reeltale.net/redeem.
10. **Kaan:** run the Meta smoke test once the key is set (`node apps/server/scripts/meta-smoke.ts`), then tell Claude
    to pre-generate the golden-path demo story.
11. **Kaan, submission** (hackathon form): the 2–3 minute demo video, the write-up (Claude drafts it in
    `docs/HACKATHON.md`), the repo link, reeltale.net, and the judge access code + accounts.

**Deadline: Tuesday Nov 4, 9:00 PM Eastern (EST; Indianapolis time).** Aim: go-live steps 1–7 done Monday Nov 2,
judge setup and the demo story Monday night, video + submission Tuesday by 6 PM to keep a buffer.

## Worker (`apps/server`, Cloudflare Worker `reeltale`)
Deploys happen through Cloudflare Workers Builds when `main` is pushed (root `apps/server`, build `npm run cf:build`,
deploy `npx wrangler deploy`). **A push to `main` is a production deploy.**

Before the first deploy:
1. Fill in `vars` in `apps/server/wrangler.jsonc`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `STREAM_CUSTOMER_CODE`, and
   `ANDROID_CERT_SHA256` (comma-separated, upload key and Play signing key, after the first EAS build).
2. Set the secrets (Kaan, in his terminal, from `apps/server`): `npx wrangler secret put <NAME>` for each:
   | Secret | Where it comes from |
   |---|---|
   | `SUPABASE_SECRET_KEY` | Supabase → Settings → API keys → secret key (`sb_secret_…`) |
   | `REVENUECAT_WEBHOOK_AUTH` | The exact Authorization header value you type into RevenueCat's webhook settings (e.g. `Bearer <random 32+ chars>`) |
   | `REVENUECAT_WEBHOOK_HMAC_SECRET` | RevenueCat webhook signing secret (shown once when you enable signing) |
   | `STREAM_API_TOKEN` | Cloudflare API token with **Stream: Edit** only |
   | `STREAM_WEBHOOK_SECRET` | Returned once by `PUT /accounts/<id>/stream/webhook` |
   | `STREAM_SIGNING_KEY_ID` / `STREAM_SIGNING_KEY_JWK` | `POST /accounts/<id>/stream/keys` → `id` and `jwk` (shown once) |
   | `TURNSTILE_SECRET` | Turnstile widget for reeltale.net |
   | `META_API_KEY` | dev.meta.ai team API key (server-side only, never in the app) |
3. Supabase: add `svc` to **Settings → API → Exposed schemas** (`public, graphql_public, svc`). The svc functions are
   EXECUTE-granted to `service_role` only, so exposing the schema doesn't open them to users.
4. Supabase: enable the **Custom Access Token** hook → `public.custom_access_token_hook` (adds the `age_ok` claim the
   Worker requires).
5. R2: create the private buckets for AI assets before the first deploy (the binding fails otherwise):
   `npx wrangler r2 bucket create reeltale-ai --jurisdiction eu` and `npx wrangler r2 bucket create reeltale-ai-staging --jurisdiction eu`.
   No public access, no custom domain. The Workflow `reeltale-story-scene` is created by the deploy itself.
6. RevenueCat webhook URL: `https://reeltale.net/api/webhooks/revenuecat`. Stream webhook URL:
   `https://reeltale.net/api/webhooks/stream` (one webhook per Cloudflare account; staging uploads are ignored by
   production via `meta.env`).

Checks after deploy:
```
curl -s https://reeltale.net/api/health
curl -sI https://reeltale.net/.well-known/apple-app-site-association   # Content-Type: application/json, no redirect
curl -s https://reeltale.net/app-ads.txt
```
Also open the site and check the browser console for CSP violations. The CSP allows no inline scripts. If Expo's
web export ever emits one, move it to a file rather than loosening the CSP.

## Database (`supabase/`)
- Tests without Docker: `npm run db:test` (PGlite). With Docker: `supabase start` then the same tests against real Postgres later.
- Deploy (Kaan runs it): `supabase link --project-ref <ref>` once, then `supabase db push`. Order for any change that also
  touches the Worker: `db push` → Worker deploy → `supabase gen types typescript --linked > packages/shared/src/database.types.ts`.
- Seed: `supabase/seed.sql` and `supabase/seeds/*.sql` (tags) are safe for every environment. Demo data (later,
  `seeds/90_demo.sql`) must never go into production.
- Access codes for judges (Kaan runs it in the SQL editor; codes are uppercase, 6–40 chars, use long random ones):
  ```sql
  insert into app_private.access_codes (code, coins, coins_expire_at, ai_days, max_redemptions, valid_until, note)
  values ('JUDGE-XXXXXXXX', 1500, '2026-11-15', 14, 50, '2026-11-10', 'hackathon judges');
  ```
- Sandbox testers (App Review and demo accounts must be on this list, or their sandbox purchases give no coins):
  `select svc.set_sandbox_tester('<uid>', true, 'app review');` (as postgres).
- Creator programme for the demo account: `select svc.set_creator_status('<uid>', 'active', '2026-10-27');` (as postgres).

## Scheduled jobs (pg_cron, to add once the project exists)
| Job | Schedule | SQL |
|---|---|---|
| Expire coin lots | every 10 min | `select svc.expire_lots();` |
| Release earnings | hourly | `select svc.release_earnings();` |
| Sweep stale AI jobs (refunds jobs whose Workflow stopped reporting) | every 5 min | `select svc.ai_sweep_stale(15);` |

Moderation. Text is reviewed by the Worker cron (needs `META_API_KEY`); episode first reviews and anything the model
was unsure about wait for an editor. Until the editor screens exist (as postgres or service role):
```sql
select svc.moderation_queue(50, null, true);                     -- the editor queue (false = the automated one)
select svc.record_verdict('series', '<id>', <version>, 'editor', null, 'approved', null, 'ok', '<editor uid>');
                                                                 -- targets: series, episode, series_edit, episode_edit
update public.profiles set role = 'editor' where id = '<uid>';   -- make someone an editor (as postgres)
select svc.remove_series('<id>');                                -- takedown; then for each returned episode:
select svc.recredit_episode('<episode>', 'moderation');          -- repeat until it returns 0
```
