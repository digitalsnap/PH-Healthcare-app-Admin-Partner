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

## Provider portals

`/partner/provider` lists the facilities the signed-in staff member's
organization owns; `/partner/provider/<facility>` is that facility's portal.
Which portal it is follows the facility type (`src/lib/provider/segments.ts`):

| Portal | Sections |
|---|---|
| Clinic | queue, bookings, calendar, schedule, services and prices, profile |
| Diagnostics | bookings (with home service), calendar, results, schedule, services and prices (with preparation instructions), profile |
| Pharmacy | stock, reservations, refills, services and prices, profile |

- Staff are assigned to an **organization** by the internal team
  (`/admin/organizations`); a facility belongs to an organization through
  `parent_org_id`. `can_manage_facility()` in the database is the single test
  of whether someone may act for a facility.
- Counter flows (booking, reservation, refill request) need the patient's
  consent tick, which is written to the access log in the same transaction.
- Result files go to the private `vault` storage bucket under
  `<facility>/<document>` and are only ever opened through a 60-second signed
  URL. The code uses the real Supabase Storage API; it has so far only been
  exercised against a local stub, so check it once a Supabase project exists.
- A facility can ask for a wrongly delivered result to be withdrawn. The
  patient stops seeing it at once; the internal team approves (the file is
  deleted) or rejects from the admin dashboard.
  If storage does not confirm the deletion, the withdrawal stays in the
  admin queue to be retried; an admin (not field staff) can close it by hand,
  which is recorded under their name (`src/lib/admin/actions/withdrawals.ts`).
- There is no billing anywhere: no invoices, payments or receipts.

## SMS

Transactional SMS is one-way. The database queues rows in `sms_message`
whenever an appointment is booked, moved or cancelled; nothing is sent until a
carrier is configured.

- `src/lib/sms/carrier.ts` is the boundary a carrier has to fit, with the
  steps to add one. `SMS_CARRIER` selects it; empty means "send nothing".
- `src/lib/sms/render.ts` composes the text at send time from fixed wording
  in `messages/*.json` (`sms.*`): a booking code, a time in Manila, a place.
- `POST /api/internal/sms/dispatch` sends what is due. A scheduler calls it
  with `Authorization: Bearer <CRON_SECRET>`. Two schedulers at once never
  send the same message, and a failure is retried up to three times.
- Reservations and refill requests have templates but do not queue anything yet.

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
