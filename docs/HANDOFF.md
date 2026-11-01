# ReelTale: handoff

Read this first, then `CLAUDE.md`. Older history is in `prep/HANDOFF.md` (D1–D2 setup notes, not in git).

## Oct 29 (evening): app scaffold + real install
- Commits: `f14651b` (backend), `4b58fa5` (ingest, trust & safety, rate limits, FX, app core). Not pushed.
- **Real `npm install` done** (754 packages, 877 MB; the scratchpad symlink is gone). `package-lock.json` exists now,
  so Workers Builds' `npm ci` can work. Disk: 11 GB free.
- `apps/mobile` is a real Expo SDK 57 app: `package.json` (versions from Expo's bundledNativeModules), `app.config.ts`
  (bundle ids, associated domains, Android app links, blocked media permissions, web output `single`), `eas.json`,
  `tsconfig.json` (extends expo/tsconfig.base, TypeScript 6.0), `src/lib/i18n.ts`, a root layout and a placeholder home.
- Verified: shared 6, Worker 152, app core 171 tests; `tsc` clean for server, shared, app core and the **whole app**
  (one RN 0.86 API change fixed in the UI kit); `npx expo export --platform web` builds (2.1 MB, no inline scripts).
- **Security gap found by running it** (`wrangler dev`, launch config `.claude/launch.json` → "worker"): with
  `run_worker_first` limited to a few paths, index.html and every SPA route were served by the asset layer with **no
  CSP or security headers**. Now `run_worker_first: true` (every request through the Worker, files via ASSETS);
  checked live with curl (CSP, HSTS, nosniff on HTML, JS and API), plus a config regression test.
- **Oct 30: the app's first full version is built** (not committed yet; ask Kaan). Foundation + four feature tracks,
  each reviewed adversarially (24 proven findings fixed, incl. buyers losing access to closed/hidden episodes they paid
  for, private AI panels cached on disk, the account-deletion subscription warning being skippable, hidden series
  looking free). Verified: app 384 tests, `tsc` clean (app, core, server, shared), Worker 153, DB 139, demo web export
  (3.8 MB, `--clear` when switching demo/live), and a click-through in the browser through the local Worker
  (`.claude/launch.json` "worker"): welcome → demo → Home → watch (free episode plays, locked episode → unlock sheet →
  plays) → story/new (ideas, tags, consent, 50 coins) → progress steps → living comic → wallet. No console errors.
  - Screens: (auth) welcome/email/code/password/birthday/blocked/terms; tabs Home, Discover, Create, Library, Me;
    series/[slug], watch/[episodeId] (pager, players pool, unlock sheet, Free Pass, progress), story/new,
    story/[id] (job progress, comic player, choices, "how it was made"), wallet, vip, settings (mature opt-in,
    AI consents, legal links, sign out, delete account), report modal, block, redeem (web only).
  - Demo mode: `EXPO_PUBLIC_DEMO=1` or automatic without Supabase; fixtures in `src/demo` + per-track `demo.ts`; demo
    state is in memory (a page reload resets coins spent).
  - Packages added by the foundation: async-storage, aes-js, hls.js 1.7.3, @expo/vector-icons, Inter + Literata fonts,
    expo-asset pinned via root `overrides` (expo-audio pulled 58).
- **App gaps (not built):** studio/upload and stop-motion maker, editor screens, Shorts feed, in-app purchases
  (RevenueCat) and VIP purchase, native Google sign-in, publishing an AI story; AI comic episodes (`r2_manifest`) can't
  play in live mode (Worker playback signs Stream only); web screen readers don't hear unlock/countdown announcements;
  an episode row shows nothing when its price fails to load; tag filter count not enforced. **Design call for Kaan:**
  white on the accent colour is 3.6:1 (below AA 4.5:1) on primary buttons and selected chips; darken the accent or
  add a darker `accentStrong` for text-on-accent.
- Nothing has run on iOS/Android or against a live Supabase/Worker yet.

## Right where the last session stopped (Oct 27, D2 evening, autonomous session while Kaan was away)
- Last finished: the AI StoryScene Workflow + `/api/ai/*` routes, and fixes for the second DB review (moderation redesign,
  four ledger edge cases, age block on both email and phone). All tests green: DB 106, Worker 58, shared 6, `tsc` clean.
- Then the moderation worker (text, on a Worker cron) with an append-only verdict log. DB 108 tests, Worker 62.
- Next up: EpisodeIngest workflow (server), then the mobile app once there's disk space.
- **First commit made locally on `main` (Oct 27, Kaan's OK), not pushed.** `origin = git@github.com:Kaanart/reeltale.git`.
  Every push needs Kaan's OK: **pushing `main` deploys production** through Cloudflare Workers Builds, and the deploy
  fails until the R2 buckets exist (open item 0). Commits here are authored as `Kaan Uysal <kaanuysal@euragnos.com>`
  (repo-local git config; the global one is a personal address and stays out of this repo's history).
- Work in progress is listed under "Status by area" below. Each area says what's verified and what isn't.

## Blockers only Kaan can clear (in this order)
1. **Disk is nearly full (3.7 GB free on Oct 27 evening).** The app's `npm install` isn't safe yet (Expo needs about 2 GB plus build
   caches), Docker can't start, and macOS gets unstable.
   Free 30–40 GB first. The cleanup list (about this machine, so not in git) is in `prep/HANDOFF.md`.
2. **Logins** in your terminal: `npx eas-cli@latest login` (account `teslakat12`), `npx wrangler@latest login`.
3. **Meta API key** into `~/.config/reeltale/secrets.env` as `META_API_KEY=…` (file exists, mode 600, values still empty).
   The smoke tests and the AI pipeline's real runs depend on it.
4. **Supabase** org `ReelTale` (Pro) → project `reeltale` (Frankfurt). Send the project ref (not secret).
5. Then step 2 of `prep/PHASE0_CHECKLIST.md`: Resend DNS, Apple IDs, Google OAuth, Turnstile, Sentry, Play app record.

## Status by area
_(updated as each area lands; see `docs/CHANGELOG.md` for detail)_
| Area | State | Verified how |
|---|---|---|
| Root workspace, CLAUDE.md, docs | written | — |
| DB foundation (schemas, privilege defaults, guards) | done | `npm run db:test` (PGlite): privilege allowlists, mutation-checked |
| DB accounts + 18+ gate + consents + deletion queue + token hook | done | `npm run db:test`: 17 tests |
| DB catalog (tags seed, series, episodes, unlock records, follows, studio RPCs) | done | `npm run db:test`: 14 tests |
| DB ledger (coins, lots, unlock, Free Pass, purchases, refunds, VIP grants, codes, AI holds, re-credit, playback check) | done; 32 + 12 review findings fixed (`prep/reviews/`) | `npm run db:test` (106 tests in all) incl. one regression per finding |
| DB moderation (first reviews, owner-only pending edits of approved content, takedown = removal with paged re-credit, review queue) | done (redesigned after the 2nd review) | `supabase/tests/moderation.test.ts` (7) |
| DB share cards (`svc.series_share_card`) | done | applies; covered indirectly |
| Worker skeleton (Hono): auth (JWKS + age_ok), RevenueCat + Stream webhooks, playback tokens, uploads, codes, AASA/assetlinks/app-ads, OG share tags, CSP | done, not deployed | `cd apps/server && npm test` (58 tests in all) + `tsc` clean |
| Shared schemas (`packages/shared`: story bible/arc/scene/panel check/manifest, API shapes) | done | `cd packages/shared && npm test` (6) + `tsc` |
| Meta Model API client (Spark/Wonder JSON, Muse Image gen/edit, SAM boxes, Voice Transcribe) + prompts | done, **not yet run against the real API** | `cd apps/server && npm test` (fake fetch) + `tsc`; live check: `node apps/server/scripts/meta-smoke.ts` once `META_API_KEY` is set |
| AI scene pipeline core (moderation → Wonder plan → sheets → script → panels → check → SAM focus → manifest) | done as functions | `apps/server/test/scene.test.ts` |
| AI DB tables (stories, scenes, jobs, lanes, budgets, audit log) | done; failed choices can be retried (charged again), blocked ones can't | `supabase/tests/ai.test.ts` |
| StoryScene Workflow (`src/workflows/scene-runner.ts` pipeline + `story-scene.ts` Workflows adapter) + `/api/ai/*` routes (start, choose, manifest, panel images) | done, **not deployed, not run on Workers** | `test/scene-runner.test.ts` (fake step runner with memo + retries), `test/ai-routes.test.ts` |
| Moderation worker: Worker cron every 2 min, `svc.moderation_queue` → Muse Spark → `svc.record_verdict` (append-only verdict log, "needs_editor" hand-off, editor queue) | done for text (series, series edits, episode title edits), **not deployed** | `test/moderation.test.ts` (Worker), `supabase/tests/moderation.test.ts` (DB) |
| EpisodeIngest workflow (Stream ready → poster/preview to R2 → captions → media + title review → `svc.record_verdict('episode', …)`) | not started; until then episode first reviews wait for an editor | — |
| Editor tools (editor queue UI, takedown buttons) | not started; SQL in RUNBOOK meanwhile | — |
| Mobile app (Expo SDK 57) | not started | needs disk space for `npm install` |

## Open items found while building (fix before launch; most before real purchases)
0. **Before the first deploy, create the R2 buckets** or Workers Builds fails on the binding (Kaan, after `wrangler login`):
   `npx wrangler r2 bucket create reeltale-ai --jurisdiction eu` and the same for `reeltale-ai-staging`. Both stay private
   (no public access, no custom domain): AI assets are only served through `/api/ai/scenes/:id/…` after the owner check.
1. **Non-EUR purchases are only valued later.** The ledger side is done: coins of unknown value leave placeholder earnings,
   and `svc.value_lot(lot, micros_per_coin)` turns them into real ones. Still missing: the job that calls it, i.e.
   `apps/server/src/lib/fx.ts` with daily ECB rates, and ideally valuing every currency directly in the RevenueCat webhook.
2. Unlock/recredit transactions funded by a sandbox tester's coins are labelled `environment = 'production'` in the log
   (cosmetic; the lots themselves carry the right environment).
3. Stream `ready` → poster/preview copy to R2 and the ingest workflow (captions, tags, safety) aren't built; posters are null.
4. CSP must be checked against the real Expo web export (no inline scripts allowed).
5. Rate limiting on `/api/*` (Cloudflare rate-limit binding or Supabase-side counters) isn't in yet; Turnstile guards codes.
   AI starts are capped per user per day in the DB (`ai_stories_per_day`, `ai_scenes_per_day`).
6. Text is moderated automatically by the cron; episodes' first reviews (media) wait for the ingest workflow or an editor.
   Rule for anything that records verdicts: target `series`/`episode` is only for a **full** first review (an episode's media
   + title together); text-only checks of later edits use `series_edit`/`episode_edit`. A `stale_verdict` needs nothing:
   the newer version is already back in the queue. Missing: a per-creator cap on edit submissions (each pending edit is
   reviewed at most once per change, after a 1-minute quiet period, but a creator could keep changing it).
7. A rejected episode can be re-uploaded (new media, back to pending). The Worker should delete the old Stream asset when the
   new one attaches (not done).
8. `studio_update_series` / `studio_update_episode` now return `'saved'` or `'awaiting_review'`; the studio UI must show the
   owner's pending edit (`public.pending_edits`, owner-only) next to the live, approved text.
9. AI panel images are behind auth: native uses `expo-image` with `source={{ uri, headers: { Authorization } }}`; web fetches
   with the header and shows a `blob:` URL (CSP already allows `blob:` images).
10. When the global AI budget breaker trips, new jobs fail and refund at the first paid step. A cheap pre-check in
    `ai_start_story`/`ai_choose` (and the showcase-replay fallback in the app) would be friendlier.
11. Second-review item left open on purpose: `environment` labels on unlock/recredit transactions (see 2 above; cosmetic).
12. Per-IP rate limits only cover failed-auth `/api/*` calls and the share-page DB lookup; association files and other
    unauthenticated Worker paths are unlimited (documented deviation; Cloudflare advises against IP keys behind NAT).
13. Purchases in currencies the ECB doesn't quote (TWD, SAR, AED, …) stay `valuation_pending` with an FX row marked
    failed; a person values them with `svc.value_lot`. Production subscription periods with a zero or unknown price also
    stay pending.
14. AI story start with a Workflow launch failure: the refund is attempted at once but errors are swallowed; the stale
    sweeper refunds later. The app's message says coins "will be returned".
(Closed on Oct 29, with tests: ingest rechecks upload consent and adulthood at review time; `block_user` treats hidden
accounts like missing ones; creators get a statement when Editor's Pick is withdrawn; FX retries land on the hourly
tick; the Worker-first routing gives static files the security headers.)

## How to continue (next session)
1. Check disk: `df -h /System/Volumes/Data`. Under ~10 GB free: don't `npm install` the app; keep to the light toolchain below.
2. Light toolchain (75 MB) was installed in the old session's scratchpad and symlinked as the repo's `node_modules`. That scratchpad
   disappears with the session, so recreate it: `rm node_modules` (it's a symlink), then in any empty folder run
   `npm install @electric-sql/pglite@0.5.12 typescript@~6.0.3 zod@^4 hono@^4 jose@^6 @cloudflare/workers-types@^4 @types/node@^24`
   and `ln -sfn <that folder>/node_modules node_modules` in the repo root. With enough disk, delete the symlink and run a real
   `npm install` at the repo root instead.
   - Run DB tests: `npm run db:test` (Node ≥ 22.18, TypeScript runs natively).
3. Pick up the first area in the table that isn't "verified".
