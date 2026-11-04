# Demo video script (2:30 target, 3:00 max)

Record the real site at https://reeltale.net in a desktop browser at 1440×900 (QuickTime → New Screen Recording,
or Cmd+Shift+5). Use a fresh private window so you start logged out. Speak the narration over the recording, or add
it as captions. Keep it honest: the catalog and the demo story on the site are **sample content**; say so.

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:15 | Landing page at reeltale.net, slow scroll over the hero and "How a scene is made" | "ReelTale is WebNovel for short video: series of one-to-two-minute vertical episodes, and stories you steer with AI." |
| 0:15–0:30 | Click **Start watching free** → Home appears | "No account needed. You confirm you're 18 or older and you're in. The first episodes of every series are free, like the first chapters on WebNovel." |
| 0:30–0:55 | Home: Weekly pick carousel, Weekly featured, Rankings, tags | "Home works like a bookstore for series: a weekly pick, featured shelves, rankings, genres. This is our sample catalog; creator uploads come next." |
| 0:55–1:20 | Open a series → watch a free episode → scroll to a locked episode → unlock sheet with its coin price | "Free episodes play straight away. Later episodes unlock with coins, and creators earn from every unlock. Coins and unlocks live in a ledger in Postgres." |
| 1:20–1:50 | Home → **Try the demo story** → comic panels → pick a choice → open **How this scene was made** | "The other half is AI stories. You write an opening, and each scene comes back as a living comic with three choices. This one is a sample; in a live story, every step here is a Meta model." |
| 1:50–2:20 | Cut to `docs/HACKATHON.md` table or `apps/server/src/ai/scene.ts`, then the Create → AI story form and the mic button | "Muse Spark checks the opening and writes each scene. Muse Wonder plans the whole story. Muse Image draws consistent panels from character sheets, Spark checks every panel, and SAM 3.1 frames the subject. On the web you can even say your choice out loud: Muse Voice Transcribe turns it into the choice you meant." |
| 2:20–2:35 | Footer / About page, then back to Home | "Every AI scene is labelled, every model call is budgeted before it runs, and the whole thing is 18-plus, as Meta's terms require. ReelTale, by Euragnos in the Netherlands." |

## Before you record
- Close other tabs, hide bookmarks, zoom 100%.
- If the carousel moves while you talk, press its **Pause** button.
- Do not show the secrets file, the judge password, or the Supabase / Cloudflare dashboards.
- If the Meta key is active by then, replace 1:20–1:50 with a real story: sign in with the judge account,
  Create → AI story, write an opening, wait for the first scene (about a minute; cut the wait), pick a choice by voice.
