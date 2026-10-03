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

## Doctor dashboard

`/partner/doctor` is today's appointments. Under it: `calendar` (day, week,
month), `appointments` (today, upcoming, past, and a page per appointment),
`appointments/new` (walk-in or phone booking), `availability` (weekly
sessions per clinic, exceptions, publish) and `profile`.

- Slots are never posted by a client. `src/lib/scheduling/generate.ts` turns
  rules and exceptions into slots; the same function powers the preview and
  the write, which goes through the `sync_schedule_slots` database function
  with the service role.
- Clinic affiliations are requested by the doctor and approved by the internal
  team (admin dashboard); only an approved clinic can carry a schedule.
- A published schedule keeps slots generated 56 days ahead. They are
  regenerated whenever a rule, an exception or the publish state changes;
  nothing yet extends the horizon on a timer.
- Booking, rescheduling and state changes are enforced by database triggers
  (seat lock, legal transitions, PRC verification) and each writes an
  `appointment_event` and queues rows in `sms_message`. Nothing sends that
  queue yet.
- Every screen that shows a patient's name writes `access_log` rows.

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
