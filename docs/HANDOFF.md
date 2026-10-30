# ReelTale: handoff

Read this first, then `CLAUDE.md`. Older history is in `prep/HANDOFF.md` (D1–D2 setup notes, not in git).

## Oct 29: four tracks merged into the main tree, all tests green, not committed yet
The four tracks below were built by agents, each reviewed adversarially and fixed (16 proven findings, all fixed with
regression tests), then **merged into the main working tree (uncommitted)**. Backups: `prep/patches/track1-3.patch`
(each worktree's changes) and `prep/patches/integration-wip.patch` (the whole main-tree diff at the time of writing).
Track 4 (app core) lives directly in `apps/mobile/src/core/`, `apps/mobile/src/i18n/`, `apps/mobile/tsconfig.core.json`.
Tracks: 1 ingest (`20261028090000_ingest.sql`), 2 trust & editor tools (`20261028090100_trust.sql`), 3 rate limits + FX
(`20261028090200_fx.sql`), 4 app core. Reports: `~/.claude/projects/-Users-kaanuysal-claude-ReelTale/c34fe42a-c069-4963-886d-75f066fa2e9b/subagents/workflows/wf_a6a08e26-90c/journal.jsonl`.

Integration fixes already applied on top (by the lead, after the reviews):
- One fence helper (`unfence`/`fenceText` in `src/ai/prompts.ts`) now used by the text cron (`moderation/review.ts`, which
  had no marker stripping: a title containing `TEXT>>>` could close the fence), `scene.ts` and `episode-media.ts`.
- `readCappedText` in `src/lib/http.ts` (moved from routes/report.ts); both webhooks use it instead of unbounded `c.req.text()`.
- Public poster cache `public, max-age=300` (was 1 year immutable: a takedown would stay cached); animated GIF preview off
  unless `INGEST_ANIMATED_PREVIEW=on` (its other ~23 frames are never reviewed).
- Ingest sweep is its own cron step (`ingestCron`), so it runs without the Meta key.
- AI story starts are idempotent: `ai_stories.request_id` + `svc.ai_start_story(..., p_request_id)`, route field
  `request_id`, app client `request_id` (one per tap, reused on retry). Tests added in ai.test.ts, ai-routes.test.ts, api.test.ts.

**Fixed since (Oct 29):** the 8 merge-fallout tests. The app maps all new server error names (strings in
`i18n/en/errors.json`; FX/ingest-only names are listed as server-only in the test); poster tests expect no animated
preview by default; the cron passes its fetch to the ingest sweep too, and the cron tests expect the sweep's one
`moderation_queue` call. Results: Worker 151/151, app core 171/171, both `tsc` clean. **The full DB suite with all
merged migrations passes: 139/139** (`perl -e 'alarm 1500; exec @ARGV' node --test supabase/tests/*.test.ts`, about
10 minutes). The agent worktrees are removed; their changes live in the main tree (and `prep/patches/`).
**Next: ask Kaan to commit**, then the real `npm install` and the Expo app.
Open items the reviewers left (add to the list below when integrating): block_user is an existence oracle for account ids
(low); no statement of reasons for Editor's Pick withdrawal (low); FX backoff waits an extra hour (low); per-IP limits
only on failed-auth /api and share pages (documented); ingest doesn't recheck upload consent at review time (medium:
add a consent check to `svc.ingest_context`); currencies the ECB doesn't quote stay pending for a person to value.

To resume the rest:
1. `pgrep -fl "node --test"`: kill leftover test processes (they once ate 4 GB of RAM).
2. Toolchain: the scratchpad symlink (`node_modules`) dies with the session. Disk has 13 GB free: delete the symlink and
   run a real `npm install` at the repo root (see "How to continue").
5. Clean up after a green full run: `git worktree unlock <path>`, `git worktree remove --force <path>`,
   `git branch -D worktree-wf_a6a08e26-90c-N` for N = 1, 2, 3. `.claude/worktrees/` is git-ignored.

App install (Expo SDK 57.0.31; versions from Expo's `bundledNativeModules.json`, use `npx expo install` to match):
react 19.2.3, react-native 0.86.3, react-dom 19.2.3, react-native-web ~0.21.0, expo-router ~57.0.29, expo-video ~57.0.5,
expo-image ~57.0.5, expo-audio ~57.0.5, expo-camera ~57.0.6, expo-secure-store ~57.0.4, react-native-reanimated 4.5.1,
react-native-worklets 0.10.1, react-native-gesture-handler ~2.32.0, react-native-screens ~4.26.0,
react-native-safe-area-context ~5.7.0, @shopify/flash-list 2.0.2, @sentry/react-native ~7.11.0 (not 8),
react-native-keyboard-controller 1.21.9, expo-dev-client ~57.0.20, expo-updates ~57.0.26. Not in Expo's list (pick
versions by hand): react-native-mmkv, react-native-purchases, @react-native-google-signin/google-signin.

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

## How to continue (next session)
1. Check disk: `df -h /System/Volumes/Data`. Under ~10 GB free: don't `npm install` the app; keep to the light toolchain below.
2. Light toolchain (75 MB) was installed in the old session's scratchpad and symlinked as the repo's `node_modules`. That scratchpad
   disappears with the session, so recreate it: `rm node_modules` (it's a symlink), then in any empty folder run
   `npm install @electric-sql/pglite@0.5.12 typescript@~6.0.3 zod@^4 hono@^4 jose@^6 @cloudflare/workers-types@^4 @types/node@^24`
   and `ln -sfn <that folder>/node_modules node_modules` in the repo root. With enough disk, delete the symlink and run a real
   `npm install` at the repo root instead.
   - Run DB tests: `npm run db:test` (Node ≥ 22.18, TypeScript runs natively).
3. Pick up the first area in the table that isn't "verified".
