-- 0007: booking rules enforced in the data layer.
--
-- DOUBLE-BOOKING: which constraint, and why
-- -----------------------------------------
-- Chosen: a partial UNIQUE index on appointment (slot_id, seat_no) for every
-- appointment that still holds its seat, plus a row lock on the slot while a
-- seat is assigned.
--
-- Not chosen: an exclusion constraint. Exclusion constraints prevent
-- overlapping ranges, which fits "one booking per time range". Our slots have
-- an integer capacity (a first-come-first-served session block is one slot
-- with capacity > 1), so the rule is "at most `capacity` live bookings per
-- slot", and an exclusion constraint cannot count. Numbering the seats
-- 1..capacity turns the counting rule into plain uniqueness, which Postgres
-- enforces atomically through the index no matter how many transactions
-- insert at once and no matter which code path they come from.
--
-- How the pieces fit:
--   1. appointment_slot_seat_key (unique index) is the guarantee. Two live
--      appointments can never share (slot_id, seat_no).
--   2. appointment_before_write() locks the slot row (SELECT ... FOR UPDATE),
--      so concurrent bookings of one slot queue up, then gives the appointment
--      the lowest free seat in 1..capacity or raises slot_full. A seat number
--      outside 1..capacity is rejected, so capacity cannot be exceeded.
--   3. appointment_after_write() recomputes slot.remaining under that same
--      lock and writes the appointment_event row.
--
-- Because this lives in triggers and an index, it holds for book_slot(), for
-- a direct INSERT, and for a reschedule (UPDATE of slot_id) alike.
--
-- Error codes raised here (SQLSTATE):
--   PH001 slot_full
--   PH002 practitioner_not_prc_verified
--   PH003 slot_mismatch (mode or practitioner differs from the slot's schedule)
--   PH004 append-only table (0001)
--   PH005 slot_not_found

create unique index appointment_slot_seat_key
  on public.appointment (slot_id, seat_no)
  where status <> 'cancelled';

create function public.appointment_before_write()
returns trigger
language plpgsql
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

create trigger appointment_before_write
  before insert or update on public.appointment
  for each row execute function public.appointment_before_write();

create function public.appointment_after_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_slot_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_slot_changed := new.slot_id is distinct from old.slot_id;
  end if;

  -- The slot rows are already locked by appointment_before_write(), and each
  -- statement here takes a fresh snapshot, so the count is exact.
  update public.slot s
  set remaining = s.capacity - (
    select count(*) from public.appointment a
    where a.slot_id = s.id and a.status <> 'cancelled'
  )
  where s.id = new.slot_id;

  if v_slot_changed then
    update public.slot s
    set remaining = s.capacity - (
      select count(*) from public.appointment a
      where a.slot_id = s.id and a.status <> 'cancelled'
    )
    where s.id = old.slot_id;
  end if;

  -- Status is never silently overwritten: every change leaves an event.
  if tg_op = 'INSERT' then
    insert into public.appointment_event (appointment_id, event, actor_id)
    values (new.id, 'booked', coalesce(public.app_actor(), new.booked_by));
  else
    if v_slot_changed then
      insert into public.appointment_event (appointment_id, event, actor_id, detail)
      values (
        new.id, 'rescheduled', public.app_actor(),
        jsonb_build_object('from_slot_id', old.slot_id, 'to_slot_id', new.slot_id)
      );
    end if;
    if new.status is distinct from old.status then
      insert into public.appointment_event (appointment_id, event, actor_id, detail)
      values (
        new.id, new.status::text::public.appointment_event_type, public.app_actor(),
        jsonb_build_object('from_status', old.status)
      );
    end if;
  end if;

  return null;
end;
$$;

create trigger appointment_after_write
  after insert or update on public.appointment
  for each row execute function public.appointment_after_write();

-- Appointments are cancelled, not deleted. (appointment_event also references
-- them with ON DELETE RESTRICT and is append-only.)
create trigger appointment_no_delete
  before delete on public.appointment
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- book_slot: the single entry point the booking API calls. One transaction:
-- lock the slot, take a seat, write the appointment and its 'booked' event.
-- Server-side only; clients never call it directly.
-- ---------------------------------------------------------------------------
create function public.book_slot(
  p_slot_id uuid,
  p_patient_id uuid,
  p_booked_by uuid,
  p_channel public.appointment_channel,
  p_service_id uuid,
  p_facility_id uuid default null,
  p_home_service boolean default false,
  p_payment_status public.payment_status default 'pay_at_counter'
)
returns public.appointment
language plpgsql
set search_path = ''
as $$
declare
  v_slot public.slot%rowtype;
  v_schedule public.schedule%rowtype;
  v_appointment public.appointment%rowtype;
begin
  select * into v_slot from public.slot s where s.id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found' using errcode = 'PH005';
  end if;
  if v_slot.remaining <= 0 then
    raise exception 'slot_full' using errcode = 'PH001';
  end if;

  select * into v_schedule from public.schedule sc where sc.id = v_slot.schedule_id;

  insert into public.appointment (
    patient_id, booked_by, channel, mode, facility_id, practitioner_id,
    service_id, slot_id, payment_status, home_service
  )
  values (
    p_patient_id, p_booked_by, p_channel, v_slot.mode,
    coalesce(p_facility_id, v_schedule.facility_id), v_schedule.practitioner_id,
    p_service_id, p_slot_id, p_payment_status, p_home_service
  )
  returning * into v_appointment;

  return v_appointment;
end;
$$;

revoke execute on function public.book_slot(
  uuid, uuid, uuid, public.appointment_channel, uuid, uuid, boolean, public.payment_status
) from public, anon, authenticated;
grant execute on function public.book_slot(
  uuid, uuid, uuid, public.appointment_channel, uuid, uuid, boolean, public.payment_status
) to service_role;
