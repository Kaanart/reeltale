# ReelTale: changelog

Newest first. One entry per finished task, including what was tried and didn't work.

## 2026-11-04: pitch video v4 (final)
- 8 new AI b-roll shots without people (Seedance 2.5, 1080p) in the dark premium style, interpolated to a true
  60 fps; real site footage, new music and the v3 look kept. The write-up's video note lists the AI parts again.
- Didn't work at first: the shots took ~6 min to render; one download was cut off when generation was paused, and
  was redone.

## 2026-11-04: pitch video v3 (60 fps, no clay figure)
- The clay character shots are gone: animated title cards, a Ken Burns move over real site stills and real footage
  of the sample AI story take their place. Rendered at 60 fps (site recordings are 30 fps captures).
- The write-up's video note now says the only AI in the video is the narration voice and the music.

## 2026-11-04: pitch video v2 (cooler look, new music)
- Same script, narration and clay shots; re-cut with a dark premium look: gradient backdrop with soft glows, footage
  in a rounded frame with a halo, captions under the frame, fade dips between sections, slowed clay shots instead of
  freezes. New modern tech-launch music bed (ElevenLabs Music v2.5, 150 s). v1 and v2 are kept side by side.
- Didn't do: Higgsfield's Katana edit workflow (needs a full reference-edit run; not enough time or credits).

## 2026-11-04: pitch video made
- AI parts generated through Higgsfield's MCP connector: 8 claymotion b-roll clips (Seedream keyframes → Seedance 2.0
  Mini), 11 narration takes (Seed Audio, voice Helena), an instrumental music bed (ElevenLabs Music v2.5). 80.83 of
  110 credits (84.23 with re-takes). Cut locally with `prep/video/scripts/assemble_final.py` together with the real site clips; every AI
  shot carries an on-screen "AI-generated" label.
- Didn't work: the Higgsfield CLI still refuses generation on a trial plan (only the MCP connector may generate);
  5 of the first 11 narration submissions were refused as "out of credits" while 96 credits were left (a concurrency
  limit), and went through on one retry. The music model returned 125 s instead of the 145 s asked for, so the
  assembly script now fades a short bed out instead of looping it. Two narration takes (B3, B11) were clipped at the
  edges and were re-taken with a longer slot. Whisper was given the script as a prompt and dropped opening words,
  so caption timing was guessed for 5 lines; the prompt is gone and 10 of 11 lines now align at ≥ 0.93.

## 2026-11-04: pitch video attempt (stopped)
- Real site clips captured with headless Chrome (`prep/video/site/`). Higgsfield CLI + skills installed and checked.
- Didn't work: Higgsfield refused generation on a trial plan, so no AI shots, narration or music were made (no credits
  spent). Stopped at 99% of Kaan's weekly tokens; next steps in HANDOFF.

## 2026-11-04: WebNovel-style Home, free start without an account, 10 free episodes
- "Coming soon" placeholder posters fill sparse storefront rows; an empty live catalog invites creators instead.
- Without a Meta key the Worker answers `ai_paused` before holding coins (was: the job failed and refunded later).
- Home rebuilt as a storefront after webnovel.com (structure only, ReelTale's own look): carousel, featured row,
  numbered rankings, tags, new arrivals, editors' choice, completed, banners, dark footer. Built by one agent,
  reviewed by another (carousel focus loss on arrow keys, poster sizes at 1024 px, AI badge overflow on phones,
  banner text contrast, duplicate demo card on an empty live catalog: all fixed).
- "Start watching free" (18+ confirmation) opens the sample catalog in one click; the ribbon offers sign-in.
- New series free their first 10 episodes (migration 20261104090100); sample series free 5.
- Shared judge account with coins and AI access (no judge accounts per person).
- Didn't work: Claude's production DB writes and reads (service-key RPCs, `supabase db query`) are refused by the
  auto-mode classifier; Kaan ran the SQL files. The Supabase admin API refuses the new sb_secret key (401); the
  legacy service_role key worked.

## 2026-11-04: "Explore the demo" on the live website
- Signed-in users see an empty catalog (no footage, no series in the database), so judges need the sample catalog:
  `/?demo=1` switches the tab into demo mode (sessionStorage `reeltale.demo`, `webDemoChoice` in lib/config.ts),
  the live landing's second button is "Explore the demo", and the demo ribbon gets "Leave the demo". App tests 517.

## 2026-11-04: R2 limits, first deploy
- Hard monthly R2 meter in Postgres (`svc.r2_reserve`, `svc.r2_has_room`), reserved before every R2 call in the
  scene and ingest workflows and the AI asset routes; new scenes refused with `storage_budget_exceeded` (503) before
  coins are held. Caps in `pricing_config` at 80% of the free tier. Tests: DB 3 new, Worker 1 new.
- First production deploy from local `wrangler deploy` (Workers Builds isn't connected).
- Didn't work: the `META_API_KEY` Worker secret was piped from an empty line in secrets.env (a masked check read it
  as set); the Meta smoke test caught it.

## 2026-11-04: website for judging, first go-live steps
- Web shell (top nav on web >= 768 px, layout primitives, footer, page titles, public `/`, `/about`, `/notice`,
  `accentStrong` for text on accent) and four tracks: catalog on desktop (hero, shelves, Discover filter sidebar,
  two-column series page), watch on desktop (9:16 player + side panel, unlock dialog), AI story on desktop + voice
  choice (web mic → 16 kHz WAV → `POST /api/ai/transcribe` → Muse Voice Transcribe, `svc.voice_allowed`, migration
  `20261101090000_voice.sql`), landing + About + DSA notice form (Turnstile).
- Didn't work: the first run of the four tracks died on the session limit mid-way; the resume told each engineer to
  finish the partial files. The per-track adversarial reviews died on the next limit and were not re-run.
- Go-live: Supabase org/project created and linked from the CLI, Worker secrets piped from the CLI and secrets file
  (never printed), public Supabase values in `wrangler.jsonc` and `cf:build`, `supabase/config.toml` for the dashboard
  settings. `supabase db push` from Claude was refused by the auto-mode classifier (production): Kaan runs it.

## 2026-10-30: the app's screens
- Built by a workflow: one foundation agent (clients, encrypted native session store, auth with the 18+ gate and
  Terms, gated routes, tabs, demo mode with fixtures and generated images), then catalog, watch, AI story and me tracks
  in parallel, each reviewed by a fresh agent that proved findings before fixing them. Two session limits cut runs
  short; both were resumed from the workflow cache, the second time with a "finish your partial work" note.
- Lead's integration: granted `series.fts` so live search matches synopses and tags (the catalog had a title-only
  fallback and a test that fails once the grant exists, as a reminder to drop it; done); moved a SQL comment out of a
  grant list (an app test parses the grants).
- Click-through in the browser (demo, through the local Worker) found no errors. Note for testers: demo coins live in
  memory, so a page reload resets the wallet.

## 2026-10-29 (night): review leftovers closed while the screens were built
- Ingest: `svc.ingest_claim_review` now answers 'no_consent' when the creator withdrew the upload-processing consent
  for Meta or is no longer a live adult; the runner hands the episode to an editor and sends nothing to the model.
- `block_user` answers hidden accounts (unknown age, blocked) like missing ids, so it can't reveal them.
- Creators now see a statement of reasons when Editor's Pick is withdrawn (it ends the series' earnings).
- FX retries are scheduled 5 minutes early so the hourly cron tick picks them up on time (they were an hour late).
- A test-only type clash (Workers vs Node `URL`) in the new config test was fixed; DB 139, Worker 153, `tsc` clean.

## 2026-10-28/29: four parallel tracks, merge, app scaffold
- Episode ingest, trust & safety + editor tools, rate limits + FX valuation, and the app core were built by four agents
  in parallel (three in isolated git worktrees), each attacked by a fresh reviewer that had to prove findings with a
  failing test before fixing them (16 fixed). The first review run died with the session limit and was resumed from the
  workflow's cache. Merge conflicts were only in env.ts, app.ts and wrangler.jsonc.
- Fixed while merging: the text-moderation prompt fence could be closed by a title; webhooks read unbounded bodies;
  public posters cached for a year (a takedown would stay visible); the animated preview published ~23 unreviewed
  frames (now off by default); the ingest sweep never ran without the Meta key; AI story starts could charge twice on a
  client retry (now idempotent with `request_id`).
- Real install and Expo scaffold; first full app typecheck and web export. Running the Worker locally showed the HTML
  had no CSP at all (asset layer bypassed the Worker); fixed with `run_worker_first: true` and a config test.
- Lesson: leftover orphaned test processes from `perl alarm` timeouts ate 4 GB of RAM; every agent prompt now includes
  a cleanup step, and runs end with a `pgrep` check.

## 2026-10-27 (evening): AI workflow, second DB review
- AI scene pipeline as a Cloudflare Workflow. `src/workflows/scene-runner.ts` holds the steps and has no `cloudflare:*`
  imports, so it's tested in Node with a fake step runner that memoises and retries like Workflows. `story-scene.ts` is the
  thin adapter (R2, PostgREST, `NonRetryableError`). One step per paid call; content blocks, provider policy blocks and
  budget stops are final; any other failure is stored as `generation_failed` (provider/DB messages are only logged, never
  shown to users). Index split: `src/app.ts` is the Hono app, `src/index.ts` only re-exports it plus the Workflow class.
- `/api/ai/stories`, `/api/ai/scenes/:id/choose`, `/api/ai/scenes/:id/manifest`, `/api/ai/scenes/:id/assets/(panel|plate)-N.webp`.
  A failed Workflow start refunds at once. Assets are served only next to the manifest of a scene the user may read.
- Bugs found while wiring it (all fixed, with tests): SAM and redraw steps reused one budget-reservation key (only the first
  call was reserved); a failed choice could never be retried; history lines could shift when a manifest was missing;
  `DbError.code` (the SQLSTATE) was used where the error name was meant.
- DB error names from the AI RPCs map to proper statuses (403 consent/access, 404 not found, 429 rate limit, 400 invalid).
  `insufficient_coins` now carries the shortfall as a number.
- **Second adversarial DB review** (fresh Opus reviewer with probe tests, `prep/reviews/db-fix-verification-2026-10-27.json`):
  - Moderation redesigned. Approval is never withdrawn in place; edits to approved series/episodes wait in
    `public.pending_edits` (owner-only) until reviewed; a trigger refuses any other change to approved fields. This closes:
    a creator undoing a rejection by editing the title (high), a creator cutting buyers off by getting an edit rejected,
    buyers seeing unmoderated text, and rejections being thrown away as stale. Rejections now apply to the reviewed version
    or newer; approvals still need the exact version (and, for episodes, attached media). Rejected media is never served,
    not even to its creator, and can only be replaced by a new upload. Takedowns are removals: new `svc.remove_series`, and
    `svc.recredit_episode` now works in pages. New `svc.moderation_queue` for the moderation worker.
  - Ledger: returned copies of nearly expired coins could be kept alive forever (now never extended twice); a subscription
    grant processed after its refund was credited; refund debt counted returned and expired coins as spent (now net
    consumption); `value_lot` skipped spends from returned copies; a second refund event for a period removed coins
    without a transaction (now once per period).
  - Age gate: the block now remembers both email and phone.
  - Still open on purpose: environment labels on sandbox-funded transactions (cosmetic).
- Moderation worker for text: a Worker cron (every 2 min; staging every 10) takes `svc.moderation_queue` (series, series
  edits, episode title edits; never episode first reviews, which need the media), asks Muse Spark (fenced text, known
  fields only), and records the decision with `svc.record_verdict` into the append-only `app_private.moderation_verdicts`.
  "review" or a provider refusal hands the item to an editor (it leaves the automated queue); API failures leave it queued.
  Editors' verdicts must name an editor/admin account. Edits wait a minute before review (the creator may still be typing).
- First local commit (not pushed), after a pattern scan and a two-reviewer read-through of all 78 files for secrets
  and for anything unsafe to make public. No credentials found. Fixed before committing: `.gitignore` now also ignores
  the `node_modules` symlink, Android `*.keystore`, EAS `credentials.json`/`credentials/`, Play service-account keys
  (`*service-account*.json`, `pc-api-*.json`) and Sentry CLI auth files; comments no longer describe an old bug in
  another app; machine-specific cleanup notes moved to `prep/`; hackathon-rules notes reworded as plain facts.
- Test bug of my own on the way: a find-and-replace made a test helper call itself; the suite spun forever. Caught by
  running the new tests one by one under a `perl alarm` timeout (macOS has no `timeout`).

## 2026-10-27: D2, autonomous session (Kaan away)
- Scaffolded the repo root: npm workspaces, `.gitignore` (keys, env files, `prep/` excluded), `CLAUDE.md`, `docs/`.
- Disk is full (1.0 GB free), so no `npm install` of the app and no Docker. See HANDOFF for the cleanup list.
- DB: foundation, accounts/18+ gate, catalog migrations, plus a PGlite test harness with Supabase stand-ins (roles, auth schema,
  Supabase's permissive default grants, so the revokes are really tested). 39 tests. A deliberate-mistake probe confirmed the
  privilege tests catch a table-wide grant, a PUBLIC execute and a missing `search_path`.
- DB ledger: coin lots with independent expiry and value, per-user wallet mutex, idempotency keys, append-only history
  (even for the owner role), unlock with expected-price check, Free Pass, sandbox-safe purchases, refunds keyed on the store
  transaction (spent coins become debt; pending earnings voided, available ones reversed), VIP grants per period, web-only
  access codes, AI holds settled exactly once, re-credit on removal, playback entitlement check. 22 tests.
  - Bug found by the tests and fixed: `citext` equality inside `search_path = ''` functions silently became
    case-sensitive. Codes are now uppercase text; the rule is in CLAUDE.md.
- AI: `@reeltale/shared` zod schemas, one source of truth for validating Meta's output and for the JSON Schema sent to it
  (strict mode; tested non-recursive, closed, depth ≤ 10). Characters must be adults (18+, 21+ for romance), enforced in the schema and in code.
- Meta client written from dev.meta.ai docs. Muse Image always has web/image search and code execution off, images go
  to Meta as data URLs (private R2 assets never get public URLs), content-policy blocks aren't retried.
- Scene pipeline core: moderation fails closed ("review" = blocked), budget reserved before every paid call, every call
  logged. A panel check "block" refuses the scene; "regenerate" redraws once. SAM box gives the focus point.
- `apps/server/scripts/meta-smoke.ts`: live check of every Meta model (~$0.10), reads the key without printing it.
- **Adversarial review of the DB (3 Opus reviewers with probe tests): 32 findings, all fixed, one regression test each.**
  The serious ones, all probe-confirmed:
  - Refunding a purchase that had paid off refund debt wiped that debt (two refunds → free episodes, no debt).
  - Sandbox (TestFlight) coins and VIP gave real value to anyone. Now only allowlisted testers get sandbox coins.
  - Non-EUR coins never created creator earnings. Placeholder earnings + `svc.value_lot` now settle them later.
  - A refunded subscription kept its spendable coins and its creators' earnings (`svc.refund_subscription_period`).
  - Coins returned after a refund came back as paid value while the debt stayed. They now cancel debt first.
  - Approved media could be swapped by a second upload. Uploads are now bound to one Stream uid; attach only works on
    draft/processing episodes.
  - Verdicts weren't tied to what was reviewed (`content_version`). A mature → general change skipped re-review.
  - Title edits cut buyers off. Buyers now keep access until a takedown.
  - Creators couldn't be deleted (RESTRICT FK). A refund arriving before its purchase was lost (`pending_refunds`).
  - AI hold keys were shared across users.
  - Smaller fixes: age-block evasion via +tags/Gmail dots/email change/phone; minors' content now hidden at once; the
    profile directory leak and `role` exposure; consent withdrawal for blocked users; deletion-job lease; lock ordering
    for remove-vs-unlock races; bounded cron batches; transaction log reconciles with lots; reserve rows no longer
    double coin totals; promo keys per user.
- Worker: Hono app with local JWT verification (Supabase JWKS, `age_ok` required), RevenueCat and Stream webhooks
  (auth header + HMAC + 5-minute timestamp window; 200 only after the DB commits), Stream direct uploads and RS256
  playback tokens (≤ 2 h), access-code redemption (web origin + Turnstile), AASA/assetlinks/app-ads.txt, OG share tags
  with strict escaping, security headers + CSP. 28 tests, `tsc` clean.
  - Test caught: `Bearer` scheme must be case-insensitive (RFC 7235).
- Tag taxonomy seed (`supabase/seeds/10_tags.sql`: 27 genres, 80 tropes, 10 warnings) written by a Sonnet agent, reviewed: all
  18+ appropriate, no minors/school/explicit tags.
