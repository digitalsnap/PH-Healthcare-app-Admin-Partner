# web

Next.js (App Router) app: admin console, doctor dashboard, provider portals,
public website and the server-side API. There is no patient web app.

Read `../CLAUDE.md` before changing anything.

## Layout

| Path | What |
|---|---|
| `src/app/(public)` | `/` and `/login` — public, read-only |
| `src/app/(admin)` | `/admin/...` — roles `admin`, `staff` |
| `src/app/(doctor)` | `/partner/doctor/...` — role `doctor` |
| `src/app/(provider)` | `/partner/provider/...` — role `provider_staff` |
| `src/proxy.ts` | Enforces the role per route group (Next.js 16 name for middleware) |
| `src/lib/` | Shared server-side business logic: `money`, `coverage`, `scheduling`, `travel` |
| `messages/` | i18n strings (`en`, `fil`) — never hardcode user-facing text |
| `../supabase/migrations/` | The schema, as numbered SQL files |

## Admin console

`/admin` is the data-freshness dashboard. Under it: `facilities` (with prices,
accreditations and verification on each facility's page), `practitioners` (PRC
verification), `services`, `coverage`, and — for the `admin` role only —
`users` and `access-log`.

- Pages read through the signed-in user's Supabase client, so row-level
  security applies. Lists are server-rendered and paginated.
- Every mutation is a server action in `src/lib/admin/actions/`, validated by
  `src/lib/admin/schemas.ts`, and writes an `access_log` row.
- Facilities need `location` rows (PSGC) to exist first; there is no location
  import screen yet.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
```

Copy `.env.example` to `.env.local` and fill it in.

## Database tests

`tests/db/` applies the real migrations to a throwaway local Postgres and
tests the booking and consent rules against it. They are skipped unless
`TEST_DATABASE_URL` is set, and the helper refuses any non-local host.

```bash
pnpm db:test:up
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres pnpm test
pnpm db:test:down
```
