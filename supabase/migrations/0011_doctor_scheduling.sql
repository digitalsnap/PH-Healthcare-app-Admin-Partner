-- 0011: what the doctor dashboard needs: publishing a schedule, appointment
-- state rules, booking codes, the SMS outbox, and the doctor's own row-level
-- security.

-- ---------------------------------------------------------------------------
-- Who am I, as a practitioner.
-- ---------------------------------------------------------------------------
create function public.own_practitioner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.practitioner p where p.app_user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- practitioner: a doctor edits their own profile, never their PRC status.
-- ---------------------------------------------------------------------------
create function public.practitioner_guard_prc_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Server jobs (no auth.uid()) and the internal team may change these.
  if (select auth.uid()) is null or (select public.is_staff()) then
    return new;
  end if;
  if new.prc_number is distinct from old.prc_number
     or new.prc_licence_expires_on is distinct from old.prc_licence_expires_on
     or new.prc_verified_at is distinct from old.prc_verified_at
     or new.prc_verified_by is distinct from old.prc_verified_by
     or new.is_live is distinct from old.is_live
     or new.app_user_id is distinct from old.app_user_id then
    raise exception 'prc_fields_are_set_by_admin' using errcode = 'PH006';
  end if;
  return new;
end;
$$;

create trigger practitioner_guard_prc_fields
  before update on public.practitioner
  for each row execute function public.practitioner_guard_prc_fields();

-- ---------------------------------------------------------------------------
-- schedule: one per practitioner and clinic; slots exist only once published,
-- and publishing needs PRC verification (enforced here, not only in the UI).
-- ---------------------------------------------------------------------------
alter table public.schedule
  add column is_published boolean not null default false,
  add column published_at timestamptz;

create unique index schedule_practitioner_facility_key
  on public.schedule (practitioner_id, facility_id)
  where practitioner_id is not null;

create function public.schedule_publish_requires_prc()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    if new.practitioner_id is not null and not exists (
      select 1 from public.practitioner p
      where p.id = new.practitioner_id and p.prc_verified_at is not null
    ) then
      raise exception 'practitioner_not_prc_verified' using errcode = 'PH002';
    end if;
    new.published_at := now();
  elsif not new.is_published then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger schedule_publish_requires_prc
  before insert or update of is_published, practitioner_id on public.schedule
  for each row execute function public.schedule_publish_requires_prc();

-- ---------------------------------------------------------------------------
-- sync_schedule_slots: the only way slots are written. The server generates
-- them from availability rules and exceptions, then hands the whole window
-- here. Slots nobody has booked are replaced; booked slots are kept and their
-- capacity updated. Service role only; no client can call it.
-- ---------------------------------------------------------------------------
create function public.sync_schedule_slots(
  p_schedule_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_slots jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.schedule s where s.id = p_schedule_id for update;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'PH007';
  end if;

  drop table if exists incoming;
  create temp table incoming on commit drop as
  select
    (x ->> 'starts_at')::timestamptz as starts_at,
    (x ->> 'ends_at')::timestamptz as ends_at,
    (x ->> 'capacity')::integer as capacity,
    (x ->> 'mode')::public.appointment_mode as mode,
    nullif(x ->> 'availability_rule_id', '')::uuid as availability_rule_id,
    nullif(x ->> 'schedule_exception_id', '')::uuid as schedule_exception_id
  from jsonb_array_elements(p_slots) as x;

  if exists (
    select 1 from incoming i
    where i.starts_at < p_window_start or i.starts_at >= p_window_end
  ) then
    raise exception 'slot_outside_window' using errcode = 'PH008';
  end if;

  -- Free slots that the rules no longer produce disappear. A slot with a live
  -- appointment is never deleted, whatever the rules now say.
  delete from public.slot s
  where s.schedule_id = p_schedule_id
    and s.starts_at >= p_window_start and s.starts_at < p_window_end
    and not exists (select 1 from incoming i where i.starts_at = s.starts_at)
    and not exists (
      select 1 from public.appointment a where a.slot_id = s.id and a.status <> 'cancelled'
    );

  insert into public.slot
    (schedule_id, availability_rule_id, schedule_exception_id, starts_at, ends_at, capacity, remaining, mode)
  select p_schedule_id, i.availability_rule_id, i.schedule_exception_id,
         i.starts_at, i.ends_at, i.capacity, i.capacity, i.mode
  from incoming i
  on conflict (schedule_id, starts_at) do update
    set ends_at = excluded.ends_at,
        mode = excluded.mode,
        availability_rule_id = excluded.availability_rule_id,
        schedule_exception_id = excluded.schedule_exception_id,
        -- Capacity never drops below what is already booked.
        capacity = greatest(excluded.capacity, public.slot.capacity - public.slot.remaining),
        remaining = greatest(excluded.capacity, public.slot.capacity - public.slot.remaining)
                    - (public.slot.capacity - public.slot.remaining)
    where public.slot.mode = excluded.mode or public.slot.remaining = public.slot.capacity;

  select count(*) into v_count from public.slot s
  where s.schedule_id = p_schedule_id
    and s.starts_at >= p_window_start and s.starts_at < p_window_end;
  return v_count;
end;
$$;

revoke execute on function public.sync_schedule_slots(uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_schedule_slots(uuid, timestamptz, timestamptz, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- appointment: booking codes, cancellation reasons and legal state changes.
-- ---------------------------------------------------------------------------
create type public.cancel_reason as enum (
  'patient_request', 'practitioner_unavailable', 'facility_closed', 'duplicate', 'other'
);

alter table public.appointment
  add column booking_code text unique,
  add column cancel_reason public.cancel_reason,
  add constraint appointment_cancel_has_reason check (
    (status = 'cancelled') = (cancel_reason is not null)
  );

-- Six characters the patient can read back over SMS: no 0/O or 1/I.
create function public.generate_booking_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

create function public.appointment_assign_booking_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_code is null then
    loop
      new.booking_code := public.generate_booking_code();
      exit when not exists (select 1 from public.appointment a where a.booking_code = new.booking_code);
    end loop;
  end if;
  return new;
end;
$$;

create trigger appointment_assign_booking_code
  before insert on public.appointment
  for each row execute function public.appointment_assign_booking_code();

-- The only state changes an appointment can make. Anything else is refused,
-- so a status is never silently overwritten.
--   booked      -> checked_in, cancelled, no_show (once the slot has started)
--   checked_in  -> seen, cancelled, no_show
--   seen        -> completed
--   completed, cancelled, no_show -> (final)
-- A reschedule (slot change) is allowed only while booked, into a future slot.
create function public.appointment_guard_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_start timestamptz;
  v_new_start timestamptz;
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'booked' and new.status in ('checked_in', 'cancelled', 'no_show'))
      or (old.status = 'checked_in' and new.status in ('seen', 'cancelled', 'no_show'))
      or (old.status = 'seen' and new.status = 'completed')
    ) then
      raise exception 'illegal_status_transition: % -> %', old.status, new.status
        using errcode = 'PH009';
    end if;
    if new.status = 'no_show' then
      select s.starts_at into v_old_start from public.slot s where s.id = old.slot_id;
      if v_old_start > now() then
        raise exception 'no_show_before_start' using errcode = 'PH010';
      end if;
    end if;
  end if;

  if new.slot_id is distinct from old.slot_id then
    if old.status <> 'booked' or new.status <> 'booked' then
      raise exception 'reschedule_requires_booked' using errcode = 'PH011';
    end if;
    select s.starts_at into v_new_start from public.slot s where s.id = new.slot_id;
    if v_new_start <= now() then
      raise exception 'reschedule_into_past' using errcode = 'PH012';
    end if;
  end if;

  return new;
end;
$$;

-- Runs before the seat trigger (alphabetical order of trigger names).
create trigger appointment_a_guard_transition
  before update of status, slot_id on public.appointment
  for each row execute function public.appointment_guard_transition();

-- ---------------------------------------------------------------------------
-- sms_message: the transactional SMS outbox. One-way only. Rows are queued by
-- the database whenever an appointment event happens, and a server job sends
-- them. The body is composed at send time from template + params + locale, so
-- no free text and no health details are ever stored here.
-- ---------------------------------------------------------------------------
create type public.sms_template as enum (
  'booking_confirmed', 'booking_rescheduled', 'booking_cancelled', 'appointment_reminder'
);

create type public.sms_status as enum ('queued', 'sent', 'failed', 'cancelled');

create table public.sms_message (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointment (id),
  to_phone text not null,
  template public.sms_template not null,
  -- booking_code, starts_at (UTC), facility_name, mode. Never names or health details.
  params jsonb not null default '{}'::jsonb,
  locale text not null default 'fil' check (locale in ('en', 'fil')),
  scheduled_at timestamptz not null default now(),
  status public.sms_status not null default 'queued',
  sent_at timestamptz,
  provider_ref text,
  created_at timestamptz not null default now()
);

create index sms_message_queue_idx on public.sms_message (status, scheduled_at);
create index sms_message_appointment_id_idx on public.sms_message (appointment_id);

alter table public.sms_message enable row level security;

create function public.queue_appointment_sms()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_phone text;
  v_starts_at timestamptz;
  v_params jsonb;
  v_reminder_at timestamptz;
begin
  select p.phone, s.starts_at,
         jsonb_build_object(
           'booking_code', a.booking_code,
           'starts_at', to_char(s.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'facility_name', f.name,
           'mode', a.mode
         )
  into v_phone, v_starts_at, v_params
  from public.appointment a
  join public.slot s on s.id = a.slot_id
  join public.patient_profile p on p.id = a.patient_id
  left join public.facility f on f.id = a.facility_id
  where a.id = new.appointment_id;

  -- No phone, no SMS: the app or the counter confirms instead.
  if v_phone is null then
    return null;
  end if;

  if new.event in ('rescheduled', 'cancelled') then
    update public.sms_message
    set status = 'cancelled'
    where appointment_id = new.appointment_id and status = 'queued' and template = 'appointment_reminder';
  end if;

  if new.event = 'booked' then
    insert into public.sms_message (appointment_id, to_phone, template, params)
    values (new.appointment_id, v_phone, 'booking_confirmed', v_params);
  elsif new.event = 'rescheduled' then
    insert into public.sms_message (appointment_id, to_phone, template, params)
    values (new.appointment_id, v_phone, 'booking_rescheduled', v_params);
  elsif new.event = 'cancelled' then
    insert into public.sms_message (appointment_id, to_phone, template, params)
    values (new.appointment_id, v_phone, 'booking_cancelled', v_params);
  end if;

  -- A reminder the day before, if there is still a day before.
  if new.event in ('booked', 'rescheduled') then
    v_reminder_at := v_starts_at - interval '24 hours';
    if v_reminder_at > now() then
      insert into public.sms_message (appointment_id, to_phone, template, params, scheduled_at)
      values (new.appointment_id, v_phone, 'appointment_reminder', v_params, v_reminder_at);
    end if;
  end if;

  return null;
end;
$$;

create trigger appointment_event_queue_sms
  after insert on public.appointment_event
  for each row execute function public.queue_appointment_sms();

-- ---------------------------------------------------------------------------
-- Row-level security for doctors. A doctor sees and manages their own
-- profile, affiliations, schedules and appointments, and the patients those
-- appointments are with.
-- ---------------------------------------------------------------------------
create policy practitioner_update_own on public.practitioner
  for update to authenticated
  using (app_user_id = (select auth.uid()))
  with check (app_user_id = (select auth.uid()));

create policy practitioner_facility_own on public.practitioner_facility
  for all to authenticated
  using (practitioner_id = (select public.own_practitioner_id()))
  with check (practitioner_id = (select public.own_practitioner_id()));

-- Verified listings are readable by any signed-in account (a doctor picks
-- clinics to affiliate with); the public site will open them further.
create policy facility_select_verified on public.facility
  for select to authenticated
  using (verification_status = 'verified');

create policy schedule_own on public.schedule
  for all to authenticated
  using (practitioner_id = (select public.own_practitioner_id()))
  with check (practitioner_id = (select public.own_practitioner_id()));

create policy availability_rule_own on public.availability_rule
  for all to authenticated
  using (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id = (select public.own_practitioner_id())
  ))
  with check (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id = (select public.own_practitioner_id())
  ));

create policy schedule_exception_own on public.schedule_exception
  for all to authenticated
  using (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id = (select public.own_practitioner_id())
  ))
  with check (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id = (select public.own_practitioner_id())
  ));

create policy slot_select_own on public.slot
  for select to authenticated
  using (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id = (select public.own_practitioner_id())
  ));

create policy appointment_update_own on public.appointment
  for update to authenticated
  using (practitioner_id = (select public.own_practitioner_id()))
  with check (practitioner_id = (select public.own_practitioner_id()));

-- The patients a doctor has an appointment with: a care relationship the
-- patient entered by booking. Every read is written to the access log by the
-- server.
create policy patient_profile_select_practitioner on public.patient_profile
  for select to authenticated
  using (exists (
    select 1 from public.appointment a
    where a.patient_id = patient_profile.id
      and a.practitioner_id = (select public.own_practitioner_id())
  ));

-- A walk-in or phone patient registered at the practice.
create policy patient_profile_insert_practitioner on public.patient_profile
  for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (select public.current_app_role()) = 'doctor'
  );

create policy sms_message_select_own on public.sms_message
  for select to authenticated
  using (exists (
    select 1 from public.appointment a
    where a.id = appointment_id and a.practitioner_id = (select public.own_practitioner_id())
  ));

-- Any console account records its own reads and writes of patient data.
drop policy access_log_staff_insert on public.access_log;
create policy access_log_insert_own on public.access_log
  for insert to authenticated
  with check (
    actor_id = (select auth.uid()) and (select public.current_app_role()) is not null
  );

-- The service catalogue is not sensitive; any signed-in account may read it.
create policy service_select_authenticated on public.service
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- practitioner_appointment_view: an appointment with its slot time and the
-- names the front office needs. security_invoker, so the caller's row-level
-- security decides which appointments (and which patients) appear.
-- ---------------------------------------------------------------------------
create view public.practitioner_appointment_view
with (security_invoker = true) as
select
  a.id,
  a.booking_code,
  a.status,
  a.payment_status,
  a.mode,
  a.channel,
  a.cancel_reason,
  a.home_service,
  a.practitioner_id,
  a.patient_id,
  p.full_name as patient_name,
  p.phone as patient_phone,
  a.facility_id,
  f.name as facility_name,
  a.service_id,
  sv.name as service_name,
  a.slot_id,
  s.schedule_id,
  s.starts_at,
  s.ends_at,
  a.seat_no,
  a.created_at
from public.appointment a
join public.slot s on s.id = a.slot_id
join public.patient_profile p on p.id = a.patient_id
left join public.facility f on f.id = a.facility_id
left join public.service sv on sv.id = a.service_id;

-- ---------------------------------------------------------------------------
-- book_walk_in: manual booking by the practice for a walk-in or phone
-- patient. One transaction: register the patient if new, record their consent
-- in the access log, and take the seat through book_slot() (so the same lock
-- and unique index apply). Service role only; the server checks first that the
-- slot belongs to the acting practitioner.
-- ---------------------------------------------------------------------------
create function public.book_walk_in(
  p_slot_id uuid,
  p_actor_id uuid,
  p_service_id uuid,
  p_patient_id uuid default null,
  p_full_name text default null,
  p_phone text default null
)
returns public.appointment
language plpgsql
set search_path = ''
as $$
declare
  v_patient_id uuid := p_patient_id;
  v_appointment public.appointment%rowtype;
begin
  -- The events written by the booking are attributed to the acting account.
  perform set_config('app.actor_id', p_actor_id::text, true);

  if v_patient_id is null then
    if p_full_name is null or btrim(p_full_name) = '' then
      raise exception 'patient_name_required' using errcode = 'PH013';
    end if;
    insert into public.patient_profile (full_name, phone, created_by)
    values (btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''), p_actor_id)
    returning id into v_patient_id;
  end if;

  -- Consent given at the counter or on the phone, recorded before the booking.
  insert into public.access_log (actor_id, subject_patient_id, action, resource_type)
  values (p_actor_id, v_patient_id, 'counter_consent.record', 'patient_profile');

  v_appointment := public.book_slot(
    p_slot_id, v_patient_id, p_actor_id, 'assisted_counter', p_service_id
  );

  insert into public.access_log (actor_id, subject_patient_id, action, resource_type, resource_id)
  values (p_actor_id, v_patient_id, 'appointment.create', 'appointment', v_appointment.id);

  return v_appointment;
end;
$$;

revoke execute on function public.book_walk_in(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.book_walk_in(uuid, uuid, uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- The booking triggers lock and update slot rows, write events and queue SMS.
-- A doctor changing their own appointment has no direct rights on those
-- tables (and must not), so the triggers run with the owner's rights. They
-- still see the caller through auth.uid().
-- ---------------------------------------------------------------------------
alter function public.appointment_before_write() security definer;
alter function public.appointment_after_write() security definer;
alter function public.appointment_guard_transition() security definer;
alter function public.appointment_assign_booking_code() security definer;
alter function public.queue_appointment_sms() security definer;

-- ---------------------------------------------------------------------------
-- A reschedule into a slot at another clinic must move the appointment's
-- facility with it. Same function as 0007, plus that one rule.
-- ---------------------------------------------------------------------------
create or replace function public.appointment_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.slot%rowtype;
  v_schedule public.schedule%rowtype;
  v_slot_changed boolean := false;
  v_recheck boolean := true;
  v_needs_seat boolean := true;
begin
  -- OLD only exists on UPDATE, so everything that reads it is derived here.
  if tg_op = 'UPDATE' then
    v_slot_changed := new.slot_id is distinct from old.slot_id;
    v_recheck := v_slot_changed
      or new.mode is distinct from old.mode
      or new.practitioner_id is distinct from old.practitioner_id;
    v_needs_seat := v_slot_changed or old.status = 'cancelled';
  end if;

  -- Lock the slot(s) involved. On a reschedule lock both in id order so two
  -- opposite reschedules cannot deadlock.
  if v_slot_changed then
    perform 1 from public.slot s
    where s.id in (old.slot_id, new.slot_id)
    order by s.id
    for update;
  end if;

  select * into v_slot from public.slot s where s.id = new.slot_id for update;
  if not found then
    raise exception 'slot_not_found' using errcode = 'PH005';
  end if;

  if v_recheck then
    if new.mode <> v_slot.mode then
      raise exception 'slot_mismatch: appointment mode differs from slot mode'
        using errcode = 'PH003';
    end if;

    select * into v_schedule from public.schedule sc where sc.id = v_slot.schedule_id;

    if v_schedule.practitioner_id is not null then
      if new.practitioner_id is null then
        new.practitioner_id := v_schedule.practitioner_id;
      elsif new.practitioner_id <> v_schedule.practitioner_id then
        raise exception 'slot_mismatch: slot belongs to another practitioner'
          using errcode = 'PH003';
      end if;
    end if;

    -- A reschedule can move between a doctor's clinics: the appointment follows
    -- the slot to the clinic that slot is held at.
    if v_slot_changed and v_schedule.facility_id is not null then
      new.facility_id := v_schedule.facility_id;
    end if;

    -- A calendar accepts bookings only after PRC verification is recorded.
    -- Checked only when the booking is made or moved, so an existing
    -- appointment can still be cancelled if verification later lapses.
    if new.practitioner_id is not null and not exists (
      select 1 from public.practitioner p
      where p.id = new.practitioner_id and p.prc_verified_at is not null
    ) then
      raise exception 'practitioner_not_prc_verified' using errcode = 'PH002';
    end if;
  end if;

  if new.status <> 'cancelled' then
    -- A moved or reinstated appointment never keeps its old seat number.
    if tg_op = 'UPDATE' and v_needs_seat then
      new.seat_no := null;
    end if;

    if new.seat_no is null then
      select min(seat) into new.seat_no
      from generate_series(1, v_slot.capacity) as seat
      where not exists (
        select 1 from public.appointment a
        where a.slot_id = new.slot_id
          and a.seat_no = seat
          and a.status <> 'cancelled'
          and a.id <> new.id
      );
      if new.seat_no is null then
        raise exception 'slot_full' using errcode = 'PH001';
      end if;
    elsif new.seat_no not between 1 and v_slot.capacity then
      raise exception 'slot_full: seat % is outside capacity %', new.seat_no, v_slot.capacity
        using errcode = 'PH001';
    end if;
  end if;

  return new;
end;
$$;
