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
