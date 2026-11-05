# ReelTale: handoff

Read this first, then `CLAUDE.md`. Older history is in `prep/HANDOFF.md` (D1–D2 setup notes, not in git).

## Nov 4 (evening) checkpoints (newest first)
- **PITCH VIDEO v6 = FINAL (8:44 PM EST): `prep/video/versions/v6/reeltale-demo.mp4`**, 2:19, full screen, 60 fps.
  Kaan's edits: new "future of entertainment" section (narration BF + title card: scroll + Netflix-style series +
  open platforms Instagram/Facebook/TikTok/WebNovel/Roblox), narration 8% faster (atempo; originals in
  `versions/v1/narration/`), site clips at 1.25x, shorter gaps and fades, no rounded frame, and NO on-screen
  "AI-generated" label (Kaan's call); the write-up's video note still discloses the AI shots, voice and music.
  v5 (same, with the label) is in `versions/v5/`.
- **PITCH VIDEO v4 = FINAL (8:25 PM EST): `prep/video/versions/v4/reeltale-demo.mp4`**, 2:25, 1080p, 60 fps.
  Kaan bought Higgsfield credits (1000). v3 + 8 new AI b-roll shots without people (Seedance 2.5 t2v 1080p: phone
  wall, closed studio door, book to screens, coins, tripod + miniature street, phone playing a film, comic panels,
  glass choice cards), motion-interpolated 24 -> 60 fps (ffmpeg minterpolate, 1600x900). Labelled "AI-generated".
  `docs/HACKATHON.md` video note matches v4 again (AI b-roll + voice + music). Submission texts:
  `prep/submission_description.txt`, `prep/project_description.txt`. NOTE: `META_API_KEY` in secrets.env is still
  empty, so live AI stories are likely still paused (`ai_paused`); the descriptions don't claim they run.
- **PITCH VIDEO v3 (8:04 PM EST): `prep/video/versions/v3/reeltale-demo.mp4`, 60 fps, no clay figure** (Kaan's ask).
  v2 look and music; the clay shots are replaced by the script's own fallbacks (animated title cards for B1/B2, Ken
  Burns over real site stills for B6, real sample-AI-story footage for B7). Clay clips parked in
  `prep/video/session/clips_clay/`. Script now renders at 60 fps (site captures are 30 fps, shown frame-doubled).
  `docs/HACKATHON.md` "About the demo video" now matches v3 (AI = narration voice + music only); if v1/v2 is
  submitted instead, that paragraph must mention the AI clay shots again. Higgsfield balance 3.97: the "plus" plan's
  100 credits were the ones already used, nothing new arrived.
- **PITCH VIDEO v2 (7:51 PM EST): `prep/video/versions/v2/reeltale-demo.mp4`** (also the current
  `prep/video/final/`). Kaan asked for a cooler, cleaner look and less generic music. Free re-edit in
  `assemble_final.py`: dark premium backdrop (near-black gradient, coral/violet glows), footage in a rounded frame
  with a soft halo, captions under the frame, 0.22 s fade dips between sections, clay shots slowed instead of
  frozen. New music `session/music/music_bed_v2.mp3` (ElevenLabs Music v2.5, 150 s, 21.8 credits); v1 music moved to
  `session/music_v1/`. Higgsfield balance now 3.97 (no new AI shots possible without more credits). Katana (Higgsfield's
  edit workflow) was looked at but not used: it needs a full reference-edit run, too slow and costly before 9 PM.
  Known: the "reeltale.net" tag slightly overlaps the site footer on B5/B10. Submission description:
  `prep/submission_description.txt`.
- **PITCH VIDEO DONE (7:34 PM EST): `prep/video/final/reeltale-demo.mp4` (2:25, 1080p, -16 LUFS) + `.srt`.**
  Made through the Higgsfield MCP connector (`https://mcp.higgsfield.ai/mcp`, Kaan added it in Claude Settings →
  Connectors); the CLI is still refused on the trial (`only_mcp_usage_on_trial_is_available`). Generated: 8 Claymotion
  keyframes → 8 Seedance 2.0 Mini clips (`prep/video/session/clips/`), 11 narration takes in voice Helena
  (`session/narration/B1..B11.wav`; B3 and B11 re-taken because the first takes were clipped at the edges, B11 now
  says "This is ReelTale. …"), a 125 s ElevenLabs Music v2.5 bed. 84.23 of 110 credits spent, 25.77 left (ledger in
  `session/budget.md`). Rebuild for free: `python3 prep/video/scripts/assemble_final.py`. Script fixes: a short music
  bed fades out instead of looping; Whisper no longer gets the script as `initial_prompt` (it dropped opening words,
  so captions were guessed). Known: the B7 clay shots hold their last frame ~1 s; Whisper spells the brand "RealTail".
  **v1 is frozen in `prep/video/versions/v1/`** (mp4, srt, assembly.json, script copy, narration takes); Kaan has edit
  ideas for a v2: build v2 from `session/`, keep v1 untouched.
  **Kaan, before 9 PM:** watch it once, upload it (YouTube unlisted or similar), put the link in the submission form,
  make the GitHub repo public, submit.
- **PITCH VIDEO STOPPED (~6 PM EST, Kaan at 99% weekly tokens):** real site clips are DONE in `prep/video/site/`
  (b3, b4, b5, b8, b10 .mp4 + posters). Higgsfield generation was REFUSED (trial plan: "end the trial or move to a paid,
  non-trial plan"), so NO AI shots, narration or music exist and no credits were spent. All prompts are ready in
  `prep/video/session/shots_plan.json` and `narration/narration_prompts.json`; voice candidates Helena / Nora
  (see `session/budget.md`). Next session, cheapest path: Kaan records the narration from docs/VIDEO.md himself
  and the site clips are cut together with ffmpeg (free), OR upgrade Higgsfield and rerun only the produce step.
  Workflow script for reference: `~/.claude/projects/-Users-kaanuysal-claude-ReelTale/c34fe42a-c069-4963-886d-75f066fa2e9b/workflows/scripts/reeltale-pitch-video-wf_b81168fd-a24.js`.
- **PITCH VIDEO RUNNING (~5:30 PM EST):** workflow `wf_b81168fd-a24` (script under
  `~/.claude/projects/-Users-kaanuysal-claude-ReelTale/c34fe42a-c069-4963-886d-75f066fa2e9b/workflows/scripts/`).
  Choices: Claymotion preset, warm female voice, soft music, burned-in captions, 16:9, ~2:30, 11 narration blocks
  (text in the script; follows docs/VIDEO.md). Real site clips (free, headless Chrome) + 8 Seedance 2.0 Mini claymotion
  shots + narration + music via Higgsfield, hard cap 95 of ~110 credits (budget log `prep/video/session/budget.md`).
  Everything lands in `prep/video/` (git-ignored): `site/`, `session/` (manifest.json), `final/reeltale-demo.mp4`
  + `.srt`. If this session dies: DON'T re-run the paid step blindly; read `prep/video/session/manifest.json` and
  budget.md, then only assemble (free) from what exists. Higgsfield CLI is signed in (workspace "Private").
- **Higgsfield set up (for the pitch video):** CLI `@higgsfield/cli` 1.2.2 installed globally (security-checked:
  postinstall downloads the `hf` binary from higgsfield-ai/cli releases with a SHA-256 check). Use the command
  `higgsfield`, NOT `hf` (on this Mac `hf` is Hugging Face's CLI from Anaconda). Skills `higgsfield-ai/skills`
  (9, incl. video-explainer, faceless-video, generate) installed user-level in `~/.claude/skills` (checked: no
  secrets access, network only to Higgsfield GitHub/Google Fonts). Kaan signs in with `higgsfield auth login`,
  then `higgsfield workspace set <id>` if asked. Plan: hybrid video (labelled AI b-roll + real site clips + captions).
- **Pitch + video script:** `docs/VIDEO.md` now holds the judge pitch (positioning "WebNovel for short video, open
  to every creator, with stories you can steer"; avoid "first": TikTok Series exists), a 90-word form pitch, the
  2:30 script and an optional labelled AI intro-clip prompt.
- **Phone footer DONE, deployed (version 9b1dba73):** the dark footer now shows on every web width (phones get two
  link columns per row); checked live at 390x844, no sideways scroll. Native still renders none (Settings has the
  legal links). App 542.
- **Placeholders DONE, deployed (version 72150b5a):** sparse Home rows fill with "Coming soon" film-frame posters
  (`padWithPlaceholders` in storefront.ts, `components/store/ComingSoon.tsx`): no titles, badges, counts or links;
  only the first per row is announced to screen readers. An empty live catalog shows a "New series are on the way /
  Become a creator" invite instead of the carousel. Reviewed (no defects proved). Checked live at 1440x900. App 542.
  Known: with an empty catalog the page is mostly placeholders (honest but repetitive). Kaan submitted the Meta
  credit form; credits not applied yet. An API key can be created now at dev.meta.ai (card on file).
- **No Meta key yet (Kaan hasn't received it).** Deployed 69e184ff: without `META_API_KEY` the Worker refuses new
  scenes with 503 `ai_paused` before holding coins (app shows "AI stories are paused for now. No coins were taken.").
  When the key arrives: put it in secrets.env, pipe it to `wrangler secret put META_API_KEY`, run the smoke test.
  Video script: `docs/VIDEO.md` (records against the sample catalog + sample story; honest narration).
- **Batch 2 DONE, deployed (version 49bd63cd):** Home is a WebNovel-style storefront (`features/catalog/storefront.ts`,
  `components/store/*`): Weekly pick carousel + Meet ReelTale, Weekly featured with Switch, Rankings (Trending/New/
  Completed, numbered), Continue watching + demo story, Popular tags, New arrivals + Editors' choice, Completed
  series, promo banners, dark footer. Reviewed (7 findings proved and fixed). Checked live at 1440x900: all sections
  render, no console errors except Cloudflare's analytics beacon (blocked by our CSP). App tests 537.
  Open (low): on the live backend Home makes one episodes query per ranking row.
- **Judge account finished by Kaan:** access code inserted and redeemed (`prep/judge-redeem.sql` via
  `supabase db query --linked`). Free-episodes migration `20261104090100` is applied (checked). The auto-mode
  classifier blocks Claude from production DB writes AND reads (service-key RPCs, `db query`): give Kaan SQL files.
- **Shared judge account (Kaan's choice):** `judge@reeltale.net` created via the admin API (legacy service_role key;
  the new sb_secret key gets 401 on /auth/v1/admin), adult birthday + Terms done. Password, user id and access code
  are in `~/.config/reeltale/secrets.env` (`JUDGE_PASSWORD`, `JUDGE_CODE`) and `~/.config/reeltale/judge_uid`.
  The code row is in `prep/judge-access.sql` (not in git): Kaan runs `supabase db query --linked -f
  prep/judge-access.sql`, then Claude redeems it for the judge with `svc.redeem_access_code` (1500 promo coins,
  30 days of AI). The password goes into the submission form only.
- **Write-up drafted:** `docs/HACKATHON.md` rewritten to match the code (only models the code calls; no TTS, no
  editor's report). Open items for Kaan at its end: how judges sign in for LIVE AI (Supabase's built-in mail only
  reaches org members: one shared password account in the submission form, or Resend SMTP), video link, brand date.
- **Batch 3 DONE (committed, needs Kaan's `db push`, not deployed):** migration `20261104090100_free_episodes.sql`
  (series default 10 free episodes; `studio_create_series` default 10), DB test. Sample series free 5 of their 6–10
  episodes (`DEMO_FREE_EPISODES`), so unlocking still shows; watch/catalog tests moved to episode 6/7. DB 147, app 518.
  Installed Anthropic's official `frontend-design` skill in `.claude/skills/` (security-checked: markdown only, Apache-2.0).
- **Batch 2 RUNNING** as workflow `wf_146e5553-87c` (build + review of the WebNovel Home; its files are uncommitted
  until it finishes). If this session dies: check `git status`, typecheck, tests, then commit and deploy.
- **Batch 1 DONE, deployed (version 4b5eacbe):** the landing's "Start watching free" (with an 18+ line) reloads the tab
  into the sample catalog and goes straight to Home as the sample account (`enterWebDemo` / `takeWebDemoEntry` in
  lib/env.ts). Ribbon: "Sample catalog · watch free, no account needed" + "Sign in for AI stories" (`/welcome?demo=0`).
  Checked in the browser on reeltale.net. App tests 518.
- Meta terms checked (credit terms, API ToS, AUP): fine to accept. Follow-ups after the deadline: make sure only
  Standard (not Contributor) models are called, and that Meta image provenance metadata survives our pipeline.
- **Next:** batch 2 = Home in the WebNovel layout (`prep/reference/webnovel/`), batch 3 = free episodes default 10
  (new migration; sample series are only 6–10 episodes long, so keep a few locked there to show unlocking),
  batch 4 = deploy, browser check, `docs/HACKATHON.md` + video script.

## Nov 4 (afternoon): NEXT SESSION, START HERE
**Deadline: TODAY, Tue Nov 4, 9:00 PM Eastern (Kaan's Indianapolis time).** The Meta credit form closes then too
(credits land within 2 business days, so they cover judging, not today; calls today bill Kaan's card, capped by
`ai_daily_cap_micros` = $20/day; offer to lower it to $5 with one SQL line).

Where things are:
- **Live:** https://reeltale.net runs `fe81e08` (R2 limits + website demo switch), deployed with local
  `npx wrangler deploy`, version 4ec2e4be. Health and `/?demo=1` return 200.
- **Supabase:** all migrations through `20261104090000_r2_limits.sql` pushed (checked with `supabase migration list
  --linked`), seeded, `supabase config push` done.
- **Worker secrets:** `SUPABASE_SECRET_KEY`, `IP_HASH_SECRET` OK. `META_API_KEY` is set but EMPTY, and the secrets file's
  line is empty too. Check by length only: `awk -F= '/^META_API_KEY=/{print length($2)}' ~/.config/reeltale/secrets.env`.
- **Website demo switch** (new, tested, not deployed): `/?demo=1` puts the tab in demo mode (sample catalog and a
  sample AI story, nothing sent anywhere); the landing's second button "Explore the demo" does that; the ribbon has
  "Leave the demo" (`/?demo=0`). Needed because signed-in users see an EMPTY catalog (no series in the database, no
  footage). Judges: demo link for the catalog, sign in for live AI stories.

Next steps, in order:
1. Kaan: put the Meta key after
   `META_API_KEY=` (`open -e ~/.config/reeltale/secrets.env`), submit the Meta credit form (team id from dev.meta.ai).
2. Claude (only needed again after code changes): rebuild the web export in apps/mobile with the public values (the same values as `cf:build` in
   apps/server/package.json: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`, `CI=1 npx expo export --platform web
   --clear --output-dir dist`), then `cd apps/server && npx wrangler deploy`. Pipe the Meta key without printing it:
   `printf %s "$(grep '^META_API_KEY=' ~/.config/reeltale/secrets.env | cut -d= -f2-)" | npx wrangler secret put META_API_KEY`
   (check that it's non-empty first). Then `node apps/server/scripts/meta-smoke.ts <scratch dir>` (about $0.10).
3. Check live: `/?demo=1` → Explore the demo → catalog, watch, story; Leave the demo; Kaan signs in by email code
   (Supabase's default mail only reaches org members: fine for him) and starts a real AI story.
4. **NEW DIRECTION (DECISIONS.md 2026-11-04): WebNovel-style storefront, first ~10 episodes free without an
   account, no judge accounts.** Before 9 PM, do the smallest version that judges feel: logged-out browsing of the
   catalog on the web (public paths for Home/Discover/series/watch of free episodes, mature hidden, one-time 18+
   confirmation), the Home layout moved toward the WebNovel screenshots (`prep/reference/webnovel/`), and
   `free_episode_count` default 10 (new migration; Kaan runs `db push`). Without footage, logged-out visitors see
   the demo catalog: simplest path is to show the demo fixtures to logged-out web visitors (the `?demo=1` mode
   already does this) and keep live mode for signed-in users. Keep tests green; deploy with `wrangler deploy`.
   Judge accounts are dropped; an access code for AI coins is still useful (RUNBOOK step 9, SQL for Kaan).
5. `docs/HACKATHON.md`: write-up (Meta usage table, judge walkthrough, access paths) + a 2–3 min video script; Kaan
   records. Submission: video, write-up, repo (make it PUBLIC: GitHub → Settings → visibility), site + `/?demo=1`.

Classifier notes: Claude's `supabase db push` was refused as a production deploy; `wrangler deploy`,
`wrangler secret put`, `git push` and `supabase projects/orgs create` went through.
Known gaps: per-track adversarial reviews never ran; live mode not yet tested end to end (sign-in, AI, voice);
Turnstile not set (the /notice form shows the support e-mail); the Cloudflare Web Analytics beacon is blocked by
our CSP (harmless; Kaan can switch it off on the zone).

## Nov 4: go-live in progress (deadline TODAY, 9:00 PM Eastern)
- **Website done:** the four tracks (catalog, watch, story + voice choice, landing + /about + /notice) finished on the
  resumed run `wf_e796e842-ee0`. App/core/Worker tsc clean; core, Worker (166) and DB tests pass. Their adversarial
  reviews did NOT run (session limit). Unverified: live mode against the real backend, Safari/Firefox, real mic.
- **Supabase:** org `Euragnos` (Free plan; upgrade to Pro later), project `reeltale`, ref `ildqgaekqsawgsveclkv`,
  Frankfurt. DB password in `~/.config/reeltale/secrets.env` (`SUPABASE_DB_PASSWORD`). Repo linked.
  `supabase/config.toml` added (exposes `svc`, access-token hook, site URL, password min 12) for `supabase config push`.
- **Live:** https://reeltale.net deployed from local (`wrangler deploy`, version 9aaf39fb), db pushed + seeded, config
  pushed, R2 buckets exist. Health, CSP and auth on /api/ai checked with curl.
- **R2 limits** (`20261104090000_r2_limits.sql`, `src/lib/r2.ts`): every R2 read/write reserved in Postgres first,
  refused at 80% of the free tier (800k class A, 8M class B a month, 8 GB stored); new scenes check room first.
  Needs Kaan's `db push` BEFORE the next Worker deploy.
- **Worker secrets set:** `SUPABASE_SECRET_KEY`, `IP_HASH_SECRET` (also in secrets.env). `META_API_KEY` was uploaded
  EMPTY (the secrets file's value is empty; my check masked it): AI is off until Kaan fills it and it is re-put. Not set:
  `TURNSTILE_SECRET` (the /notice form then shows the support e-mail), Stream/RevenueCat (not needed for judging).
  Public Supabase URL + publishable key are in `wrangler.jsonc` and baked into `cf:build`, so Workers Builds needs no
  variables.
- **Waiting on Kaan:** `supabase db push --include-seed` and `supabase config push` (the auto-mode classifier blocks
  Claude from pushing to the live DB), and enabling R2 in the Cloudflare dashboard (wrangler: error 10042).
- **Then Claude:** create R2 buckets `reeltale-ai` / `reeltale-media` (`--jurisdiction eu`), `wrangler deploy` from
  `apps/server` (the repo had never been pushed, so Workers Builds isn't wired; deploy is local), judge accounts +
  access code, Meta smoke test, golden-path story, `docs/HACKATHON.md`.

## Nov 1: WEB FIRST (Kaan's decision; see DECISIONS.md)
- Commits: `eb14b88` (app). Not pushed.
- **Go-live checklist for Kaan: `docs/RUNBOOK.md` → "Go live for judging"** (Supabase project + db push, dashboard
  settings, wrangler login, R2 buckets, secrets, Workers Builds EXPO_PUBLIC_* variables, then the first push).
- **Nov 1 status:** the web shell is DONE (uncommitted): top nav on web >= 768 px, layout primitives in
  `components/layout`, footer, page titles, public web paths `/`, `/about`, `/notice`, `accentStrong` #BF3722 for
  text-on-accent (resolves the contrast design call). The four website tracks (catalog, watch, story + voice,
  landing + notice) **did not run** (session limit); resume run `wf_e796e842-ee0` when Kaan wants to spend the tokens.
  Footage isn't ready: judging = live AI stories + demo mode; no Stream setup. Deadline: **Tue Nov 4, 9:00 PM EST**.
- **Website workflow**, run `wf_e796e842-ee0`, script
  `~/.claude/projects/-Users-kaanuysal-claude-ReelTale/c34fe42a-c069-4963-886d-75f066fa2e9b/workflows/scripts/reeltale-website-wf_e796e842-ee0.js`
  (task specs inside): web shell (desktop top nav, layout primitives, footer, page titles, public routes `/`, `/about`,
  `/notice`, accessible accent), then catalog / watch / story + voice choice (Muse Voice Transcribe, new
  `POST /api/ai/transcribe`, migration `20261101090000_voice.sql`) / landing + DSA notice form, each reviewed. If a
  session died mid-run: resume with the run id (same session) or check `git status`, typecheck, demo export, and
  finish the incomplete track from the specs (new session).

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
