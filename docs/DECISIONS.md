# ReelTale: decisions

The full product and architecture plan is `prep/BLUEPRINT.md` (approved Oct 22, not in git). This file records
decisions made since, newest first, with the reason. Change a decision by adding a new entry, not by editing an old one.

## 2026-11-01
- **Web first for the hackathon (Kaan).** The native apps likely won't be ready by Nov 4, so the submission is the
  website at reeltale.net (the Expo web build served by the Worker). Work from here prioritises what judges see on the
  web: desktop layout, the live backend (Supabase + Worker + Meta models), demo content, judge access codes, and the
  write-up. The iOS/Android builds, store submissions, in-app purchases and native-only features move after the
  hackathon. The code stays one Expo codebase, so nothing built for the web is thrown away.

## 2026-10-27
- **Sandbox purchases only work for allowlisted testers** (`svc.set_sandbox_tester`): App Review, demo and judge accounts,
  our own devices. Everyone else on public TestFlight gets nothing from sandbox purchases. Judges use web access codes
  instead, and their coins sync to the apps.
- **Buyers keep access while an edit is re-reviewed.** Only a takedown (removed/rejected) or a creator who is no longer a
  live adult cuts them off, and removal re-credits them. New viewers only ever see approved content.
- **Moderation verdicts carry the reviewed `content_version`.** A verdict for an older version returns `stale_verdict`
  and changes nothing.
- **Content of an under-18 or deleting creator stops being served immediately** (series hidden, creator programme
  suspended). Buyers are re-credited when the deletion job removes it.

- **Series by creators outside the creator programme are entirely free.** Default prices would otherwise lock their
  episodes while Euragnos kept the money, contradicting the Creator Terms ("Apply to earn"). Locks appear once
  `creator_accounts.status = 'active'`. The demo creator account is activated by hand.
- **AI access counts production money only:** a production coin purchase, an active production VIP, or
  `ai_access_until` from a code or the reviewer allowlist. Sandbox (TestFlight/App Review) purchases and sandbox subscriptions
  never count, because they're free.
- **Coin value is recorded only for EUR purchases for now.** RevenueCat's `price` is in USD; for other currencies the lot
  is marked `valuation_pending` and valued later from an ECB rate (job not written yet). Creator earnings from those coins
  are calculated once valued (the unlock path currently records 0 for unvalued coins: see HANDOFF open items).
- **The Worker talks to Supabase with plain `fetch` to PostgREST**, not supabase-js: secret key only for `svc.*`, the
  user's own JWT for `public.*`. Fewer dependencies, and the two calling conventions stay visible in code.
- **Cloudflare Stream through its REST API with a Stream-only token**, not the Workers binding: the binding's config
  format couldn't be verified, and a wrong binding breaks the deploy.
- **Access codes are web-only** (the Worker requires the `Origin` to be reeltale.net, and Turnstile). The native apps never
  show redemption (App Store 3.1.1); coins sync to them through the shared wallet.

- **All code is written after kickoff** (Oct 26, 17:00 CET). The Official Rules weren't public yet when building started; when they
  appear, check them for a public-repo requirement, non-Meta models (we use Gemini TTS/video through Cloudflare) and IP terms.
- **Fresh code.** Patterns known from our earlier app Feetmax (Apple sign-in nonce, token revocation, age gate, webhook checks) are
  reimplemented from scratch during the event; no Feetmax code is copied.
- **`prep/` is not committed.** The repo may have to go public for judging; prep contains research with business numbers. Legal
  drafts that ship get copied into `legal/`.
- **Verification without Docker or a full install.** The disk is full, so SQL is tested against PGlite (Postgres compiled to
  WebAssembly) with small stubs for Supabase's `auth` schema and roles. Unit tests use Node's built-in test runner. Both get re-run
  against real local Supabase (`supabase start` + pgTAP) once Docker works again.

- **Moderation: approval is never withdrawn in place.** Edits to approved content are pending edits until reviewed;
  takedowns are removals that re-credit buyers. Chosen over per-field "approved copies" columns because it keeps every
  reader of `title`/`synopsis` (search, share cards, the app) on reviewed text with no extra columns or views, and a
  trigger makes the rule hold even if a future RPC forgets it.
- **AI pipeline code split for testing.** The Workflow class can't be imported in Node (`cloudflare:*` modules), so the
  pipeline is a plain function over a small step-runner interface, and the Workflow is a few lines of glue.

## 2026-10-22 to 2026-10-26 (from earlier sessions)
- Worker deploys go through Cloudflare's Git integration (Workers Builds), not GitHub Actions: no Cloudflare token in GitHub.
  Worker name `reeltale`, root directory `apps/server`, build command `npm run cf:build`, deploy `npx wrangler deploy`, preview builds off.
- Event waiver: the entrant keeps ownership. Meta, Cerebral Valley and their partners get a perpetual, non-exclusive licence to the
  Submission. Discord and office-hours content is non-confidential.
- Everything in the blueprint's "Confirmed decisions" table (18+ only, SDK 57, Supabase + one Worker, coin-grant VIP, payouts at the
  end of the following month through Stripe Connect Express, Editor's Pick for AI series, legal pages on eurastudios.com).
