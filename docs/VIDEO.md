# ReelTale: submission pitch and demo video

## The pitch (how we sell it to the judges)

**Positioning: "WebNovel for short video, open to every creator, with stories you can steer."**

Short vertical dramas are one of the fastest-growing ways people watch stories, but the big apps are closed
studios: you can watch, you can't make. WebNovel proved the other model for text: anyone can publish, the first
chapters are free, readers unlock the rest with coins, and writers earn. ReelTale brings that model to short
video, and adds what only AI makes possible: stories a reader can steer, built scene by scene by Meta's models.

Say "an open platform" and "anyone 18+ can publish". **Don't say "the first"**: TikTok Series already lets
creators sell paid series, and judges may know it. Our real edge is the combination below.

**Three things to land, matched to what judges score:**
1. **Product and impact:** an open storefront for short series. The first episodes of every series are free to anyone,
   without an account. Later ones unlock with coins, and creators earn from every unlock.
2. **Use of Meta's models (the core):** an AI story is a pipeline of five Meta models.
   - Muse Spark checks the opening, writes each scene and three choices, and checks every panel.
   - Muse Wonder plans the whole story.
   - Muse Image draws consistent panels from character sheets.
   - SAM 3.1 frames the subject.
   - Muse Voice Transcribe lets you *say* your choice.
3. **Built to launch, not a mock-up:**
   - a real coin ledger in Postgres;
   - every model call budgeted before it runs, with automatic refunds;
   - 18+ enforced in the database, as Meta's terms require;
   - every AI scene labelled;
   - an EU illegal-content notice form;
   - over 850 automated tests.

**Elevator pitch for the submission form (about 90 words):**
> ReelTale is WebNovel for short video. Anyone 18+ can publish a series of one-to-two-minute vertical episodes; the
> first episodes of every series are free to watch without an account, and later ones unlock with coins that pay
> creators. Readers who'd rather steer than watch write an opening, and Meta's models build a living comic scene by
> scene: Muse Wonder plans it, Muse Spark writes and safety-checks it, Muse Image draws it, SAM 3.1 frames it, and
> Muse Voice Transcribe lets you say your choice. Live at reeltale.net, with a real coin ledger, budgets and 18+
> safeguards.

**Claims to keep honest on camera:**
- The catalog on the site is **sample content**: say "sample catalog".
- The demo AI story is a **sample**, not real model output.
- Live AI turns on once the Meta API key is active. Don't show a live story unless it really ran.

## Demo video script (2:30)

Record https://reeltale.net in a private browser window at 1440×900 (QuickTime → New Screen Recording, or
Cmd+Shift+5). Speak the narration over it, or add it as captions. About 330 words at a calm pace.

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:12 | Landing page hero, slow scroll | "Short vertical dramas are everywhere, but the apps are closed studios: you can watch, you can't make. ReelTale is WebNovel for short video." |
| 0:12–0:30 | Click **Start watching free** → Home appears | "Anyone can start watching. No account: you confirm you're eighteen or older and you're in. Like the first chapters on WebNovel, the first episodes of every series are free." |
| 0:30–0:50 | Home: Weekly pick carousel, Weekly featured, Rankings, Popular tags. Text overlay: *Sample catalog* | "It's a storefront for series: a weekly pick, featured shelves, rankings and genres. What you see is our sample catalog; the shelves fill as creators publish." |
| 0:50–1:10 | Open a series → play a free episode → scroll to a locked one → unlock sheet with its coin price | "Free episodes play straight away. Later ones unlock with coins, and creators earn from every unlock. Anyone eighteen or older can publish a series." |
| 1:10–1:35 | Home → **Try the demo story** → panels → pick a choice. Overlay: *Sample AI story* | "And when you'd rather steer than watch: write an opening, and the story comes back as a living comic, one scene at a time, with three choices for what happens next." |
| 1:35–2:00 | Open **How this scene was made**, then Create → AI story form with the mic button. Overlay of the five model names | "Every live scene is built by Meta's models. Muse Wonder plans the whole story. Muse Spark checks the opening, writes each scene and checks every panel. Muse Image draws consistent characters. SAM 3.1 frames the shot. And on the web you can say your choice out loud: Muse Voice Transcribe turns it into the choice you meant." |
| 2:00–2:20 | Quick cuts: `docs/HACKATHON.md` model table, a test run in the terminal (passing), the footer with imprint and "For adults 18+" | "It's built to launch, not a mock-up: a real coin ledger, every model call budgeted before it runs, adults-only enforced in the database, every AI scene labelled, and over eight hundred and fifty automated tests." |
| 2:20–2:30 | Back to Home, then the landing hero with **reeltale.net** | "ReelTale. Watch the start of any story for free, or steer your own. Live now at reeltale.net." |

**If the Meta key is active before you record:** replace 1:10–1:35 with a real story. Sign in with the judge account,
Create → AI story, write an opening, cut the wait for the first scene, pick a choice by voice. Then change the
narration to "This scene was just made live by Meta's models."

### Before you press record
- Use a private window, so you start logged out. Close other tabs, hide bookmarks, set zoom to 100%.
- Press the carousel's **Pause** while you talk over it.
- Never show the secrets file, the judge password, or the Supabase or Cloudflare dashboards.
- For the test run cut (2:00), this is safe to show:
  `node --test apps/mobile/src/core/__tests__/*.test.ts`
- Export at 1080p. Add captions if the platform allows; many judges watch muted.

## Optional: a 5-second AI intro clip

Only if you want a cinematic opener, made with any video tool. It must carry an on-screen "AI-generated" label, and
the write-up must say it was made with an AI video tool. Never present it as the app.

> Vertical 9:16, 5 seconds, cinematic, warm practical light. Close-up of a hand holding a phone in a dark room; the
> screen glows with a grid of colourful vertical video posters. A thumb swipes up and the posters ripple like
> pages of a book turning. Shallow depth of field, soft film grain, no text, no logos, no real people's faces.

Put the "ReelTale" title and URL over the clip in your editor, not inside the generated video.
