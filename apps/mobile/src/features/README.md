# Feature folders

Read this, then the comment at the top of `src/lib/data.ts`, before writing a screen.

## Who owns what

| Track | Folder | Routes (`src/app/...`) | i18n namespaces |
|---|---|---|---|
| foundation | `features/auth`, `lib/`, `demo/` | `_layout.tsx`, `(auth)/*`, `(tabs)/_layout.tsx` | `auth`, `age`, `common` (ask before adding) |
| catalog | `features/catalog` | `(tabs)/index`, `(tabs)/discover`, `(tabs)/library`, `series/[slug]`, `shorts` | `home`, `series` |
| watch | `features/watch` | `watch/[episodeId]`, the unlock sheet | `watch`, `unlock` |
| story | `features/story` | `(tabs)/create`, `story/*` | `story`, `ai`, `create` |
| me | `features/me` | `(tabs)/me`, `wallet`, `vip`, `settings`, `report`, `redeem` (web only) | `profile`, `wallet`, `vip`, `settings`, `report`, `redeem` |

Only edit your own folder, routes and namespaces. Need something in `lib/`, `components/ui` or another
feature? Ask the owner. Packages are installed by the foundation only.

## Screens and routes

- Route files are thin: `export { SeriesScreen as default } from '../../features/catalog/screens/SeriesScreen';`
  Screens, hooks and components live in your feature folder.
- Every route outside `(auth)` is behind the 18+ gate automatically (`FeatureRouteGuard` in
  `src/app/_layout.tsx`). Don't add auth checks, and don't add your routes to the root layout. Set screen
  options (title, `presentation: 'modal'`) from inside the screen with `<Stack.Screen options={...} />`.
- The five tab files are placeholders: replace yours in place.
- `useAuth()` / `useUserId()` / `useRole()` / `useIsEditor()` from `features/auth` give the session. Identity
  never comes from a route param or a text field, and no RPC takes a user id.

## Data: one pattern, live or demo

Hooks call `fromSource({ demo, live })` (see `src/lib/data.ts`). `live` uses `rpc()`, `select(db()...)` or
`api.*`; `demo` returns fixtures from `src/demo` or your own `features/<track>/demo.ts` (import, don't edit
`src/demo`). Changes in demo mode go into a `demoState('<track>.<name>', ...)` cell. Images: `demoCover()`,
`demoPanelImage()`. Demo mode has no network at all (the API client fails fast), and nothing in it is
purchasable. The watch track supplies its own local placeholder video for demo playback.

Select only granted columns (`*_COLUMNS` in `src/lib/types.ts`). Show errors with
`describeError(err)` from `src/core/errors.ts`: `t(info.key, info.params)`, never `err.message`.

## Query keys

`userKey(userId, '<feature>', ...rest)` with `enabled: !!userId`, for example
`userKey(userId, 'catalog', 'series', slug)`. Invalidate with a prefix (`userKey(userId, 'wallet')`).
Sign-out clears the whole cache. Queries never retry a 4xx; mutations never retry on their own.
After changing the mature opt-in, call `useAuthActions().setMatureOptIn(on)` (it reloads the account).

## Strings

- `useTranslation()` and `t('namespace:path.to.key')`. No English in components, labels or a11y props.
- Add keys to your namespace's JSON in `src/i18n/en/`. No new namespaces (a test pins the list).
- Curly apostrophes and quotes only (’ “ ”), plurals as `_one` / `_other` with `{{count}}`.
- Outside `redeem`, never mention codes, promos, the website or buying elsewhere (App Store 3.1.1).
- Run `node --test apps/mobile/src/core/__tests__/*.test.ts` from the repo root: it checks all of this.

## Platform files

- `Thing.tsx` is the iOS/Android version and the one TypeScript checks; `Thing.web.tsx` overrides it on the
  web with the same exports (import the props type from `Thing.tsx`). Examples:
  `features/auth/providers.ts` / `providers.web.ts`, `components/AppleSignInButton(.web).tsx`.
- A web-only route (redeem): `redeem.web.tsx` is the screen, `redeem.tsx` just `<Redirect href="/" />`, so
  the native apps never contain it.
- Video: `expo-video` on iOS/Android, `hls.js` on the web (set `enableWorker: false` or the CSP blocks
  its worker).

## Rules that bite

- AI-made content always shows `AIBadge` (it has no prop to hide it).
- Tokens only (`src/theme/tokens.ts`); 44 pt touch targets; `accessibilityRole` and labels on everything
  you can press. Accent text is too light for small text on paper: use `ink` for links.
- Pure logic (no React) goes in a plain `.ts` module with a `node:test` file in `src/core/__tests__/`;
  relative imports in those modules carry the `.ts` extension so node can run them.

## Web layout

The website (reeltale.net) is the Expo web build, and judges open it on a laptop. Everything here lives in
`src/components/layout` (owner: foundation); import from `'../../../components/layout'`. Native apps are
unchanged: every piece below is a no-op or a plain column there.

**Size classes.** `useLayout()` gives `size` (`compact` < 768 ≤ `medium` < 1100 ≤ `wide`, by window width),
`gutter` (16 / 24 / 32), `isWeb`, and `hasTopNav` (web at medium or wide). An unmeasured window counts as
compact. The numbers are tokens: `breakpoints`, `layout.*` in `src/theme/tokens.ts`. Use `size`, never a raw
width check, so every screen switches at the same points.

**The shell (already on every screen).** `SiteShell` in the root layout adds, on the web:
- the **top bar** for signed-in adults at medium/wide: wordmark, Home / Discover / Create / Library, search
  (opens `/discover?focus=search`: Discover may focus its field when `focus=search` is set), the coin balance
  (to `/wallet`) and Me. Links are real `<a href>` with `aria-current`, a keyboard focus ring and hover. The
  bottom tab bar is hidden there; phones and the apps keep it. The bar sits above your screen, so don't add a
  second app header on wide web (Home's own "ReelTale + search" row can go when `hasTopNav`).
- a **public bar** on the public pages for everyone else: wordmark + Sign in (or Continue, back to the
  birthday / Terms step, for an account that is signed in but not through the gate).
- the **browser tab title** (see below).
A full-window screen (the player) may call `useHideTopNav()`; nothing else should.

**Pages.** Wrap a screen in `PageContainer` instead of `SafeAreaView` + `ScrollView`:
```tsx
<PageContainer>{...}</PageContainer>                     // centred column, max 1200, gutters, scrolls
<PageContainer width="reading">                          // 760: series page, settings ('narrow' 560: forms)
<PageContainer scrollViewProps={{ refreshControl }}>     // pull-to-refresh and other ScrollView props
<PageContainer scroll={false}>                           // your own FlashList fills it; see the footer below
```
It pads the native safe area (top, left, right by default; `edges` to change), marks the column as the web
`main` landmark, and ends with the footer.

**Grids and columns.**
```tsx
<ResponsiveGrid items={series} keyExtractor={(s) => s.id} minItemWidth={160} maxColumns={6}
  renderItem={(s, { width }) => <SeriesTile series={s} width={width} />} />   // as many columns as fit
<ResponsiveGrid columns={{ compact: 1, medium: 2, wide: 3 }}>{cards}</ResponsiveGrid>
<TwoColumn main={<Episodes />} side={<SeriesInfo />} stickySide sideLabel={label} />
```
`ResponsiveGrid` measures itself (right inside a `TwoColumn` too) and renders every item: fine for a few
dozen; for long lists use FlashList with `numColumns={gridColumns(width, { minItemWidth, gap })}`.
`TwoColumn` puts the side panel (360) beside the main column on wide windows (`from="medium"` for earlier)
and stacks them below that (main first, `sideFirst` to flip).

**Footer.** `SiteFooter` (web, every width; two link columns per row on phones): About (`/about`), Terms, Privacy, Community guidelines, AI
policy (hosted pages, new tab), Report illegal content (`/notice`), the imprint and "For adults 18+".
`PageContainer` adds it; a screen that scrolls itself puts `<SiteFooter />` last in its scroll content
(FlashList: `ListFooterComponent={SiteFooter}`). The tab screens get it when they move to `PageContainer`.

**Page titles.** `usePageTitle(text)` at the top of a screen sets `<text> · ReelTale` while the screen is
focused (web only). Pass translated text; `null`/`undefined` while loading keeps the default. Defaults:
the tab's name on the five tabs, `ReelTale` everywhere else. Never put personal data (email, display name)
in a title. One call per screen, never in a layout or a list row.

**Public pages.** Signed-out visitors may open exactly `/`, `/about` and `/notice` on the web
(`PUBLIC_WEB_PATHS` in `lib/gate.ts`); every other route still goes through the gate, and the native apps
have no public pages. `/` shows the welcome screen to visitors until the landing page exists; signed-in
adults get Home there. A public page shows no personal data, works without `useUserId()`, and gets the
public bar from the shell. Adding a path to the list makes it public: ask the foundation first.

**Colour.** The brand `accent` is decoration only (white on it is 3.6:1). Text on an accent background, and
accent-coloured text, use `accentStrong` with `onAccent` text (5.5:1): `Button` (primary, ghost) and the
selected `TagChip` already do. `src/core/__tests__/contrast.test.ts` checks the numbers.

**Links on the web.** For your own web links use `ShellLink` (an `<a href>` with hover and focus state) or
Expo Router's `<Link>`; add `focusRing` to anything focusable you style yourself, from `useInteraction()`.
