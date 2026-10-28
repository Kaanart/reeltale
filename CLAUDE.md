# ReelTale: rules for working in this repo

Read `docs/HANDOFF.md` first. It says where the last session stopped and what is blocked.
The approved blueprint is `prep/BLUEPRINT.md` (not in git). `docs/DECISIONS.md` records every decision since.

## Working rules (Kaan's)
- **Commits:** ask before every commit and every push. On "ok", run them yourself. Never hand Kaan a git command to paste.
  Pushing `main` deploys the Worker through Cloudflare Workers Builds, so a push is a production deploy.
- **Logins** (`supabase login`, `npx eas-cli login`, `npx wrangler login`, Sentry wizard) are run by Kaan in his own terminal.
- **Live database:** write SQL to a file and give Kaan the exact command (`supabase db push`, etc.). He runs it and pastes the output.
- **Parity:** every feature ships on iOS and Android (and web where it can). If a store forbids something, build the allowed version and say so.
- **Docs:** update `docs/HANDOFF.md` and `docs/CHANGELOG.md` after each finished task, including what didn't work.
- **Secrets:** never in git, never in chat. Local smoke-test secrets live in `~/.config/reeltale/secrets.env` (mode 600). Read the file
  without printing values. Worker secrets go in `wrangler secret put` / the Cloudflare dashboard, app config in EAS env.

## Stack
- `apps/mobile`: Expo **SDK 57**, Expo Router, TypeScript, plain `StyleSheet` + tokens from `src/theme/tokens.ts`.
- `apps/server`: Cloudflare Worker `reeltale` (Hono). Serves the Expo web export as static assets, plus `/api/*`.
- `packages/shared`: zod schemas shared by the app and the Worker.
- `supabase/`: migrations, seed and SQL tests. Postgres is the source of truth for coins, unlocks, earnings and AI jobs.

## SQL rules (each one prevents a real Supabase pitfall)
- Supabase grants `anon` and `authenticated` ALL on new tables by default. Every migration that creates a table runs
  `revoke all on <table> from anon, authenticated` and then grants specific columns. Verify with `information_schema.role_table_grants`.
- Functions: EXECUTE is revoked from `public, anon, authenticated` by default (first migration). Grant each user RPC explicitly.
- User RPCs live in `public`. They take identity only from `(select auth.uid())`, never a user-id parameter.
  Service RPCs live in `svc`, are executable by `service_role` only, and start with `perform svc.require_service_role();`.
- Every `security definer` function has `set search_path = ''` and schema-qualifies every name.
- No table-wide UPDATE grants. Moderation status defaults to `pending`. Money and audit tables never cascade from `auth.users`.
- `citext` comparisons inside `search_path = ''` functions silently become case-sensitive text equality. Normalize case
  explicitly (`lower()`/`upper()`), or use `operator(extensions.=)`.
- Approved series/episode fields never change in place: edits go to `public.pending_edits` and only
  `app_private.apply_edit` (called by `svc.set_moderation`) writes them. Takedowns are removals that re-credit buyers.
- PL/pgSQL: don't reuse a declared record variable's name as a table alias in a query inside the function.
- Never edit an applied migration. Add a new one. (None is applied yet; until the first `db push` the files are still edited in place.) Deploy order: `supabase db push` → Worker deploy → `supabase gen types`.

## Tests
- `npm run db:test`: migrations and SQL invariants against PGlite (Postgres in WebAssembly, with Supabase stubs). No Docker needed.
- macOS has no `timeout`: wrap a suspect test run in `perl -e 'alarm 120; exec @ARGV' node --test …`.
- `npm test`: unit tests through Node's built-in runner (`node --test`, TypeScript runs natively on Node ≥ 22.18).
