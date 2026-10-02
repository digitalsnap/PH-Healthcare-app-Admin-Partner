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
