-- 0006: scheduling tables.
--
-- Slots are generated server-side from availability_rule + schedule_exception.
-- No client computes or posts slots. Every instant (slot, exception,
-- appointment, event) is timestamptz in UTC and rendered in Asia/Manila.
-- Booking rules and the double-booking guarantee are in 0007.

create type public.appointment_mode as enum ('in_person', 'teleconsult');

-- ---------------------------------------------------------------------------
-- schedule: a calendar owned by a practitioner, or by a facility resource
-- (room, machine, branch counter).
-- ---------------------------------------------------------------------------
create table public.schedule (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid references public.practitioner (id) on delete cascade,
  -- For a practitioner schedule: the clinic where the sessions are held.
  -- For a resource schedule: the facility that owns the resource.
  facility_id uuid references public.facility (id) on delete cascade,
  facility_resource text,
  -- IANA zone the rules' wall-clock times are read in. The Philippines has no
  -- DST and one zone; it is stored explicitly so nothing ever assumes the
  -- server's timezone.
  timezone text not null default 'Asia/Manila',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_has_one_owner check (
    (practitioner_id is not null and facility_resource is null)
    or (practitioner_id is null and facility_id is not null and facility_resource is not null)
  )
);

create index schedule_practitioner_id_idx on public.schedule (practitioner_id);
create index schedule_facility_id_idx on public.schedule (facility_id);

create trigger schedule_set_updated_at
  before update on public.schedule
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- availability_rule: a recurring session.
--
-- start_time / end_time are a recurrence pattern ("Mondays 09:00-12:00"), not
-- timestamps: they are wall-clock times read in schedule.timezone and only
-- become instants when the server generates slot rows (UTC timestamptz).
-- First-come-first-served clinics use one long session block with
-- capacity_per_slot > 1, not fake per-minute slots.
-- ---------------------------------------------------------------------------
create table public.availability_rule (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedule (id) on delete cascade,
  -- ISO weekday: 1 = Monday ... 7 = Sunday.
  weekday smallint check (weekday between 1 and 7),
  -- RFC 5545 RRULE for anything that is not simply weekly.
  recurrence text,
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null check (slot_minutes > 0),
  capacity_per_slot integer not null default 1 check (capacity_per_slot >= 1),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes >= 0),
  mode public.appointment_mode not null default 'in_person',
  -- Calendar dates in schedule.timezone.
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_rule_has_recurrence check (weekday is not null or recurrence is not null),
  constraint availability_rule_times_ordered check (end_time > start_time),
  constraint availability_rule_dates_ordered check (valid_to is null or valid_to >= valid_from)
);

create index availability_rule_schedule_id_idx on public.availability_rule (schedule_id);

create trigger availability_rule_set_updated_at
  before update on public.availability_rule
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- schedule_exception
-- ---------------------------------------------------------------------------
create type public.schedule_exception_type as enum ('blackout', 'holiday', 'leave', 'extra_session');

create table public.schedule_exception (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedule (id) on delete cascade,
  exception_type public.schedule_exception_type not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  -- Only for extra_session: how the added session is sliced.
  slot_minutes integer check (slot_minutes > 0),
  capacity_per_slot integer check (capacity_per_slot >= 1),
  mode public.appointment_mode,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_exception_range_ordered check (ends_at > starts_at),
  constraint schedule_exception_extra_session_shape check (
    (exception_type = 'extra_session')
    = (slot_minutes is not null and capacity_per_slot is not null and mode is not null)
  )
);

create index schedule_exception_schedule_range_idx
  on public.schedule_exception (schedule_id, starts_at, ends_at);

create trigger schedule_exception_set_updated_at
  before update on public.schedule_exception
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- slot: generated, never client-written.
-- ---------------------------------------------------------------------------
create table public.slot (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedule (id) on delete cascade,
  availability_rule_id uuid references public.availability_rule (id) on delete set null,
  schedule_exception_id uuid references public.schedule_exception (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity >= 1),
  -- Maintained by the appointment triggers in 0007; never written directly.
  remaining integer not null,
  mode public.appointment_mode not null,
  created_at timestamptz not null default now(),
  constraint slot_range_ordered check (ends_at > starts_at),
  constraint slot_remaining_within_capacity check (remaining between 0 and capacity),
  -- Regenerating slots from the same rules is idempotent.
  unique (schedule_id, starts_at)
);

create index slot_starts_at_idx on public.slot (starts_at);

-- ---------------------------------------------------------------------------
-- appointment
-- ---------------------------------------------------------------------------
create type public.appointment_channel as enum ('app', 'web', 'assisted_counter', 'sms', 'bot');

create type public.appointment_status as enum (
  'booked', 'checked_in', 'seen', 'completed', 'cancelled', 'no_show'
);

create type public.payment_status as enum (
  'pay_at_counter', 'pending', 'paid', 'refunded', 'waived'
);

create table public.appointment (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_profile (id),
  -- Always separate from patient_id: a care manager, a counter assistant or
  -- the patient's own account.
  booked_by uuid not null references public.app_user (id),
  channel public.appointment_channel not null,
  mode public.appointment_mode not null,
  facility_id uuid references public.facility (id),
  practitioner_id uuid references public.practitioner (id),
  service_id uuid not null references public.service (id),
  slot_id uuid not null references public.slot (id),
  -- Seat within the slot, 1..slot.capacity. Assigned by trigger (0007).
  seat_no integer not null,
  status public.appointment_status not null default 'booked',
  payment_status public.payment_status not null default 'pay_at_counter',
  home_service boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_in_person_has_facility check (mode <> 'in_person' or facility_id is not null),
  constraint appointment_home_service_is_in_person check (not home_service or mode = 'in_person')
);

create index appointment_patient_id_idx on public.appointment (patient_id);
create index appointment_practitioner_id_idx on public.appointment (practitioner_id);
create index appointment_facility_id_idx on public.appointment (facility_id);
create index appointment_booked_by_idx on public.appointment (booked_by);

create trigger appointment_set_updated_at
  before update on public.appointment
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- appointment_event: one row per state change. Append-only.
-- ---------------------------------------------------------------------------
create type public.appointment_event_type as enum (
  'booked', 'rescheduled', 'cancelled', 'no_show', 'checked_in', 'seen', 'completed'
);

create table public.appointment_event (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointment (id) on delete restrict,
  event public.appointment_event_type not null,
  -- Null actor = system job.
  actor_id uuid references public.app_user (id),
  at timestamptz not null default now(),
  -- Ids only (e.g. from_slot_id / to_slot_id on a reschedule). No health details.
  detail jsonb not null default '{}'::jsonb
);

create index appointment_event_appointment_at_idx on public.appointment_event (appointment_id, at);

create trigger appointment_event_append_only
  before update or delete on public.appointment_event
  for each row execute function public.forbid_mutation();
