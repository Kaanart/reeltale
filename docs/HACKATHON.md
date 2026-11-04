# ReelTale — Hackathon submission

> **Event:** Meta Global AI Developer Hackathon. **Track:** Indie. **Theme:** Build for Your World.
> **Builder:** Kaan Uysal (solo, with an AI coding assistant). **Publisher after the event:** Euragnos B.V. (NL).
> **Links:** web https://reeltale.net · repo https://github.com/Kaanart/reeltale · video _[link]_

## One-liner
ReelTale is WebNovel for short video: serialized vertical episodes of one to two minutes, where the first episodes
of every series are free to watch without an account, later ones unlock with coins, and anyone can write an opening
and let Meta's models turn it into a branching, illustrated story they steer, by tapping or by saying their choice.

## The problem (Build for Your World)
Short-drama apps are closed studios: viewers can watch, nobody else can make anything. WebNovel showed that open,
serialized storytelling with "first chapters free, then coins" works for text. Video is the expensive part. Meta's
models make a branching, illustrated story cheap enough to generate per reader, so ReelTale can be open to creators
and to readers who want to steer a story themselves.

## Try it (no account needed)
1. Open **https://reeltale.net** and press **Start watching free** (you confirm you're 18+; no sign-up).
2. You're in the sample catalog: browse Home, Discover and a series page, watch the free episodes, and see a
   locked episode's coin price. Everything there is sample data on your device (the ribbon says so).
3. Open **Try the demo story** on Home: a living comic made with AI. Pick a choice, open **How this scene was made**.
4. **Live AI stories** need an account (Meta's terms require 18+ accounts): _[how judges sign in: see the note at
   the end of this file]_. Then Create → AI story → write an opening; on the web you can also press the mic and
   *say* your choice (Muse Voice Transcribe).

## How Meta's models power it (what the code really calls)
| Model | What it does in ReelTale | Where |
|---|---|---|
| Muse Spark 1.3 | Checks the story opening before anything is made; writes every scene (captions, dialogue, three choices, structured JSON); checks each panel for safety and character consistency (redraw once, or stop and refund); moderates titles and synopses of creator series | `apps/server/src/ai/scene.ts`, `moderation/review.ts` |
| Muse Wonder 1.0 | Plans the story at the start: story bible (every character an adult) and the branching arc | `scene.ts` (planStory) |
| Muse Image 1.0 | Character sheets, then each panel anchored on the sheets so characters stay consistent | `scene.ts`, `ai/meta.ts` |
| SAM 3.1 | Finds the subject of each panel, so the camera move centres on it | `ai/meta.ts` (focusBox) |
| Muse Voice Transcribe | "Say your choice": the browser records up to 8 s, the Worker checks the WAV and the user's voice consent, Meta transcribes, the app matches it to a choice. No audio is stored | `routes/voice.ts`, `features/story/voice` |

Every model call is reserved against a per-scene budget and a global daily budget in Postgres **before** it is made;
a failed or blocked scene refunds the coins automatically. Every call is logged for the EU AI Act audit trail and
shown in "How this scene was made".

## Architecture
Expo (React Native, one codebase; the website is its web build) → **Supabase** Postgres (coin ledger, RLS, column
grants, service-only `svc` functions) + a **Cloudflare Worker** (Hono API, strict CSP, rate limits) that runs
**Workflows** to orchestrate the Meta calls one durable step at a time, stores panels in **R2** (private, served only
after an access check) and serves the site. Hard limits keep R2 and model spend inside budget.

## Built during the hackathon (Oct 26 – Nov 4)
- Database: 18+ gate, profiles, catalog with moderation states, coin ledger (lots, expiry, unlocks, Free Pass,
  access codes), AI jobs and budgets, trust & safety (reports, EU DSA notice form, editor tools), FX valuation.
- Worker: auth (JWKS), AI story routes, scene and ingest Workflows, voice transcription, rate limits, R2 limits.
- App/website: sign-in with the 18+ gate, Home/Discover/Library/series, vertical player with unlock sheet, AI story
  creation and the comic player with choices and voice, wallet, settings, desktop layout, landing page, About,
  DSA notice form, "Start watching free" without an account.
- Tests: about 150 database tests (PGlite), 167 Worker tests, 518 app tests.
- Full history: `docs/CHANGELOG.md`, decisions in `docs/DECISIONS.md`.

## Pre-existing assets (before kickoff, Oct 26 2026 17:00 CET)
**No application, server or database code was written before kickoff.**
| Date | Asset | Notes |
|---|---|---|
| 2026-10-22 | Product blueprint, research notes, screen specs (`prep/`, not in the repo) | Planning documents |
| 2026-10-22 → | Legal document drafts | Prose |
| 2026-10-22 | Domain reeltale.net | No site yet |
| _[date]_ | Brand: name, logo/icon | |
| before the event | Know-how from an earlier app (Feetmax): Apple sign-in nonce, age gate, webhook checks | Reimplemented; no code copied |

## Honest status
- No filmed series yet: the catalog visitors see is sample data, labelled as such. Real creator uploads (Cloudflare
  Stream + the ingest Workflow with Spark safety checks) are built but have no content yet.
- The native iOS/Android apps share the code but weren't submitted to the stores; the website is the entry.

## What's next
Creator uploads with real series, store launch, creator payouts, Meta video models as soon as there is an API.

---
_Note for Kaan before submitting (delete this section): Supabase's built-in email only reaches members of the
Euragnos org, so judges can't sign up by e-mail code yet. For live AI stories either give judges one password account
in the submission form, or set up Resend SMTP (custom domain mail). Also fill in the video link and the brand date._
