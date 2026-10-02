# Build prompts

Run these in order with Claude Code from the project root. Each one is a session.
Do not start a prompt until the previous one's output has been reviewed and committed
by you.

Build order is fixed: admin console → doctor and provider dashboards → patient app.
Supply before demand. See CLAUDE.md.

---

## Prompt 1 — Foundation and schema

```
Read CLAUDE.md first and follow it exactly, especially the git rules.

Set up the foundation for this project. Stage 1 of the build order is the
admin console, so this session covers the skeleton it sits on.

1. SCAFFOLD
Create web/ as a Next.js app: App Router, TypeScript strict mode, Tailwind,
ESLint, src/ directory, import alias @/*. Use pnpm. Do not initialise git.

Add to web/:
- Zod for all input validation
- @supabase/supabase-js and @supabase/ssr
- A lib/ folder with these empty-but-typed modules, since they are the shared
  business logic the Kotlin and Swift clients will call later:
    lib/coverage/   — coverage stacking
    lib/scheduling/ — slot generation and booking
    lib/travel/     — travel estimates
    lib/money/      — centavo helpers
Write .env.example with the Supabase variables. Do not create .env.

2. DATABASE SCHEMA
Create supabase/migrations/ with numbered SQL files. Enable postgis.
Model these tables, with snake_case names and UUID primary keys:

Geography and supply:
  location (PSGC region/province/municipality/barangay codes)
  facility (type enum incl. yakap_clinic, diagnostic_center, pharmacy,
            hospital_public, hospital_private, rhu, health_center,
            barangay_health_station, private_clinic; parent_org_id for chains;
            psgc codes; geography(point,4326); licences; hours jsonb;
            verification_status; last_verified_at)
  practitioner (prc_number, specialties, prc_verified_at, prc_verified_by)
  practitioner_facility (affiliations)
  service (consult, lab_test, imaging, procedure, medicine)
  service_prep (preparation instructions per test)
  price_item (service, facility, amount_min_centavos, amount_max_centavos,
              source enum facility_confirmed|patient_reported|estimated,
              observed_at)

Coverage:
  coverage_program (philhealth_yakap, gamot, hmo_plan, senior_discount,
                    pwd_discount, assistance_program; rules_version; source_url)
  accreditation (facility x coverage_program, valid_from, valid_to, source)

Scheduling — read the Scheduling section of CLAUDE.md before writing these:
  schedule (practitioner_id or facility_resource, timezone)
  availability_rule (schedule, weekday/recurrence, start_time, end_time,
                     slot_minutes, capacity_per_slot, buffer_before_minutes,
                     buffer_after_minutes, valid_from, valid_to)
  schedule_exception (date range, type blackout|holiday|leave|extra_session)
  slot (schedule, starts_at, ends_at, capacity, remaining,
        mode in_person|teleconsult)
  appointment (patient_id, booked_by, channel app|web|assisted_counter|sms|bot,
               mode in_person|teleconsult, facility, practitioner, service,
               slot, status, payment_status, home_service bool)
  appointment_event (appointment, event, actor, at)

People and consent:
  app_user (auth identity), patient_profile (may exist without an app_user)
  care_circle, circle_membership (role patient|care_manager|payer|viewer,
                                  consent_method, granted_at, revoked_at)
  access_log (actor, subject_patient, action, at)

Admin:
  verification_task, data_source_import

Rules to enforce in SQL, not just in app code:
- All money columns are integer centavos. No numeric/float for money.
- All timestamps timestamptz, stored UTC.
- A unique constraint or exclusion constraint that makes double-booking a slot
  impossible under concurrent inserts. Explain in a comment which you chose and why.
- Row-level security enabled on every table holding patient data, with policies
  that check circle consent rather than inferring it from a relationship row.
- An appointment cannot reference a practitioner whose prc_verified_at is null.

3. AUTH AND ROLES
Supabase auth with a role on the account: admin, staff, doctor, provider_staff.
Route groups in web/src/app: (public), (admin), (doctor), (provider).
Middleware that enforces the role per route group. Patients have NO web app —
do not create patient routes.

4. VERIFY
Run typecheck and lint. Write tests for the centavo helpers and for concurrent
slot booking (two simultaneous bookings on a one-capacity slot: exactly one wins).
Report the results.

Do not commit anything. Leave the working tree as edited and tell me what is
ready for review.
```

---

## Prompt 2 — Admin console

```
Read CLAUDE.md. Build the admin console at /admin. This is the internal tool my
field reps and I use, and it ships before any partner sees anything.

Screens:
1. Facilities — list with filters (type, municipality, verification status,
   last_verified_at), detail view, create and edit. Show a prominent
   "last verified" badge that turns amber past 60 days and red past 90.
2. Practitioners — list, detail, and a PRC verification workflow:
   record prc_number, who verified, when, and the licence expiry. A practitioner
   cannot be marked verified without all three. Unverified practitioners are
   visibly blocked from going live.
3. Services and prices — per facility. Price entry writes amount_min_centavos
   and amount_max_centavos plus a source label. Never let a price be saved
   without a source and an observed_at date.
4. Coverage programs and accreditations — including YAKAP and GAMOT status per
   facility, with valid_from, valid_to and a source URL.
5. Data freshness dashboard — the landing page. Show: listings verified in the
   last 90 days as a share of total, facilities with no price data, pharmacies
   with no stock report in 7 days, and a work queue of what to verify next.
6. Users and roles — invite staff, assign roles, view the access log.

Requirements:
- Every list is server-rendered and paginated. No client-side fetch-all.
- Every mutation is a server action with Zod validation.
- Every write to patient-adjacent data writes an access_log row.
- Forms must work on a phone: my reps use this in the field on mobile data.
- No patient data appears in this console except through an explicit, logged lookup.

Run typecheck, lint and tests. Do not commit.
```

---

## Prompt 3 — Doctor dashboard, calendar and scheduler

```
Read CLAUDE.md, including the Scheduling section. Build the doctor dashboard at
/doctor. Front office only — no clinical charting, no notes, no billing.

1. Profile — specialties, clinic affiliations, PRC status (read-only, set by admin).
2. Availability rules — recurring clinic sessions per affiliated facility:
   weekday, start and end time, slot length, capacity per slot, buffers,
   valid_from and valid_to. Multiple clinics with different schedules must work.
3. Exceptions — blackout dates, holidays, leave, extra sessions.
4. Slot generation — server-side only, derived from rules and exceptions.
   Never let a client post arbitrary slots. Add a preview so the doctor sees
   what the rules produce before saving.
5. Calendar — month, week and day views. Drag to reschedule. Manual booking for
   walk-ins and phone calls. Every change writes an appointment_event.
6. Appointment list — today, upcoming, past. Cancel and reschedule as first-class
   flows with their own rules and notices, never a delete plus insert.
7. No-show marking, and reminders queued to SMS.

Hard requirements:
- Booking runs in a transaction with a row lock or the exclusion constraint from
  prompt 1. Prove it with a concurrency test.
- All times stored UTC, rendered Asia/Manila.
- A doctor with prc_verified_at null cannot publish a schedule.

Run typecheck, lint and tests. Do not commit.
```

---

## Prompt 4 — Provider portals

```
Read CLAUDE.md. Build the provider portal at /provider, role-scoped by segment.

Clinic (YAKAP clinics — free segment, no billing anywhere in this UI):
  profile, services, hours, YAKAP badge, schedule and bookings, queue status.

Diagnostics (multi-branch):
  branches, test catalogue, prices with source labels, prep instructions
  (fasting etc.), slots per branch, home-service scheduling, result delivery
  to the patient's vault.

Pharmacy:
  GAMOT accreditation status, stock flags for common maintenance medicines with
  a "confirmed today" action, reservations, refill requests.

All segments:
  assisted booking — book or reserve on behalf of a walk-in patient, with the
  patient's consent recorded at the counter and written to the access log.

Mobile-first. A pharmacy assistant updates stock on a phone behind a counter.

Run typecheck, lint and tests. Do not commit.
```

---

## Prompt 5 — Teleconsult

**Do not run this until the health-law review clears.** See R5 in the risk register.

```
Read CLAUDE.md, including the Scheduling and teleconsult rules.

Add teleconsult to the doctor dashboard and appointment flow.

- Appointments get mode = teleconsult. A doctor marks which availability rules
  are teleconsult-capable.
- Managed WebRTC provider (compare Daily and LiveKit for PH latency and cost;
  recommend one, ask before installing).
- One short-lived room token per appointment, issued server-side, valid only in a
  window around the scheduled time, only to the patient, the practitioner, and
  consented circle members allowed to join.
- Waiting room, join and leave states, audio-only fallback for weak connections,
  clear reconnect handling.
- NEVER record video, audio or transcript. Store only metadata: times, duration,
  outcome, technical_failure flag.
- Consult summary: the doctor writes a summary and attaches files, then releases
  it to the patient's vault. This is a document, not a clinical record.
- If a session fails technically, the appointment can be rescheduled without the
  patient paying twice.

Do not build electronic prescribing. A doctor uploads a prescription file.

Run typecheck, lint and tests. Do not commit.
```

---

## Prompt 6 — Public website and SEO

```
Read CLAUDE.md. Build the public, unauthenticated website.

- Facility pages: services, hours, coverage accepted, last-verified date,
  Malasakit desk status for hospitals, directions.
- Municipality pages: what is available in each town in the pilot area, with the
  nearest verified option for primary care, diagnostics and medicines.
- Cost estimate, no account required: pick a service and a facility, enter
  coverage, see a range with source labels and the disclaimer.
- Assistance guides: program pages with owner, source link and review date.
- Every page ends in "book in the app" with a download link. There is no patient
  web app and no patient login on the web.
- One-page payment link for family abroad to pay for a booking.

Server-rendered, fast on weak connections, Filipino and English through the i18n
framework. No analytics or ad pixels on any page showing health, coverage or
assistance content.

Run typecheck, lint and tests. Do not commit.
```

---

## Then

The Android (Kotlin) patient app is the next codebase, in `android/`. Do not start
it until the dashboards above have real partner data flowing through them —
a patient app with no bookable calendars behind it is worth nothing.
