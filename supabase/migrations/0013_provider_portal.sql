-- 0013: the provider portals (clinic, diagnostics, pharmacy).
--
-- Provider staff are assigned to an organization and may manage every
-- facility under it. Everything they can see or change is decided here by
-- can_manage_facility(), not by the UI.

-- ---------------------------------------------------------------------------
-- organization_staff: which provider-staff account works for which
-- organization. Assigned by the internal team.
-- ---------------------------------------------------------------------------
create table public.organization_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  app_user_id uuid not null references public.app_user (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, app_user_id)
);

create index organization_staff_app_user_id_idx on public.organization_staff (app_user_id);

alter table public.organization_staff enable row level security;

create policy staff_all on public.organization_staff
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

create policy organization_staff_select_own on public.organization_staff
  for select to authenticated
  using (app_user_id = (select auth.uid()));

-- True when the caller is active provider staff of the organization that owns
-- this facility.
create function public.can_manage_facility(p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.facility f
    join public.organization_staff os on os.organization_id = f.parent_org_id
    join public.app_user u on u.id = os.app_user_id
    where f.id = p_facility_id
      and os.app_user_id = (select auth.uid())
      and u.role = 'provider_staff'
      and u.is_active
  );
$$;

create policy organization_select_own on public.organization
  for select to authenticated
  using (exists (
    select 1 from public.organization_staff os
    where os.organization_id = organization.id and os.app_user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- facility: provider staff keep their own contact details and hours current.
-- Identity, location, ownership and verification stay with the internal team.
-- ---------------------------------------------------------------------------
create policy facility_select_managed on public.facility
  for select to authenticated
  using ((select public.can_manage_facility(id)));

create policy facility_update_managed on public.facility
  for update to authenticated
  using ((select public.can_manage_facility(id)))
  with check ((select public.can_manage_facility(id)));

create function public.facility_guard_admin_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select public.is_staff()) then
    return new;
  end if;
  if new.name is distinct from old.name
     or new.facility_type is distinct from old.facility_type
     or new.parent_org_id is distinct from old.parent_org_id
     or new.region_code is distinct from old.region_code
     or new.province_code is distinct from old.province_code
     or new.municipality_code is distinct from old.municipality_code
     or new.barangay_code is distinct from old.barangay_code
     or new.geog::text is distinct from old.geog::text
     or new.licences is distinct from old.licences
     or new.verification_status is distinct from old.verification_status
     or new.last_verified_at is distinct from old.last_verified_at
     or new.last_verified_by is distinct from old.last_verified_by then
    raise exception 'facility_fields_are_set_by_admin' using errcode = 'PH015';
  end if;
  return new;
end;
$$;

create trigger facility_guard_admin_fields
  before update on public.facility
  for each row execute function public.facility_guard_admin_fields();

-- ---------------------------------------------------------------------------
-- Catalogue: services, prices, preparation instructions, coverage status.
-- ---------------------------------------------------------------------------

-- A provider may add a test or medicine that is missing from the catalogue,
-- but not rename or remove catalogue entries others rely on.
create policy service_insert_provider on public.service
  for insert to authenticated
  with check ((select public.current_app_role()) = 'provider_staff');

create policy price_item_managed on public.price_item
  for all to authenticated
  using ((select public.can_manage_facility(facility_id)))
  with check ((select public.can_manage_facility(facility_id)));

-- Default preparation instructions (no facility) are readable by any
-- signed-in account; a facility's own instructions are managed by its staff.
create policy service_prep_select on public.service_prep
  for select to authenticated
  using (facility_id is null or (select public.can_manage_facility(facility_id)));

create policy service_prep_managed on public.service_prep
  for all to authenticated
  using (facility_id is not null and (select public.can_manage_facility(facility_id)))
  with check (facility_id is not null and (select public.can_manage_facility(facility_id)));

-- Coverage programs are public information.
create policy coverage_program_select_authenticated on public.coverage_program
  for select to authenticated
  using (true);

-- A facility's staff see its accreditations (YAKAP, GAMOT); only the internal
-- team records them.
create policy accreditation_select_managed on public.accreditation
  for select to authenticated
  using ((select public.can_manage_facility(facility_id)));

create policy stock_report_select_managed on public.stock_report
  for select to authenticated
  using ((select public.can_manage_facility(facility_id)));

create policy stock_report_insert_managed on public.stock_report
  for insert to authenticated
  with check (
    (select public.can_manage_facility(facility_id))
    and reporter_type = 'pharmacy'
    and reported_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Scheduling for facility resources (a room, a machine, a counter, a
-- home-service team). Same tables and the same slot rules as doctors.
-- ---------------------------------------------------------------------------
create policy schedule_managed on public.schedule
  for all to authenticated
  using (practitioner_id is null and (select public.can_manage_facility(facility_id)))
  with check (practitioner_id is null and (select public.can_manage_facility(facility_id)));

create policy availability_rule_managed on public.availability_rule
  for all to authenticated
  using (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id is null
      and public.can_manage_facility(s.facility_id)
  ))
  with check (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id is null
      and public.can_manage_facility(s.facility_id)
  ));

create policy schedule_exception_managed on public.schedule_exception
  for all to authenticated
  using (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id is null
      and public.can_manage_facility(s.facility_id)
  ))
  with check (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and s.practitioner_id is null
      and public.can_manage_facility(s.facility_id)
  ));

-- The front desk sees every slot held at its facility, doctors' included.
create policy slot_select_managed on public.slot
  for select to authenticated
  using (exists (
    select 1 from public.schedule s
    where s.id = schedule_id and public.can_manage_facility(s.facility_id)
  ));

create policy appointment_select_managed on public.appointment
  for select to authenticated
  using ((select public.can_manage_facility(facility_id)));

create policy appointment_update_managed on public.appointment
  for update to authenticated
  using ((select public.can_manage_facility(facility_id)))
  with check ((select public.can_manage_facility(facility_id)));

create policy sms_message_select_managed on public.sms_message
  for select to authenticated
  using (exists (
    select 1 from public.appointment a
    where a.id = appointment_id and public.can_manage_facility(a.facility_id)
  ));

-- ---------------------------------------------------------------------------
-- appointment_home_visit: where a home-service booking takes place. An
-- address is personal data, kept out of the appointment row and visible only
-- to the patient, their consented care manager and the facility doing the visit.
-- ---------------------------------------------------------------------------
create table public.appointment_home_visit (
  appointment_id uuid primary key references public.appointment (id) on delete restrict,
  address_line text not null,
  barangay_code text references public.location (psgc_code),
  landmark text,
  created_at timestamptz not null default now()
);

alter table public.appointment_home_visit enable row level security;

create policy appointment_home_visit_select on public.appointment_home_visit
  for select to authenticated
  using (exists (
    select 1 from public.appointment a
    where a.id = appointment_id
      and (
        public.is_patient_self(a.patient_id)
        or public.has_circle_consent(a.patient_id, array['care_manager']::public.circle_role[])
        or public.can_manage_facility(a.facility_id)
      )
  ));

-- ---------------------------------------------------------------------------
-- Pharmacy: reservations and refill requests. A reservation is a hold for
-- pickup only. Nothing here issues or processes a prescription; the patient
-- presents theirs at the counter.
-- ---------------------------------------------------------------------------
create type public.reservation_status as enum ('reserved', 'ready', 'picked_up', 'cancelled', 'expired');

create table public.reservation (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facility (id),
  -- A service row of type 'medicine'.
  service_id uuid not null references public.service (id),
  patient_id uuid not null references public.patient_profile (id),
  reserved_by uuid not null references public.app_user (id),
  channel public.appointment_channel not null,
  quantity integer not null default 1 check (quantity between 1 and 1000),
  status public.reservation_status not null default 'reserved',
  -- The pharmacy holds the item until this instant.
  hold_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reservation_facility_status_idx on public.reservation (facility_id, status, hold_until);
create index reservation_patient_id_idx on public.reservation (patient_id);

create trigger reservation_set_updated_at
  before update on public.reservation
  for each row execute function public.set_updated_at();

create type public.refill_status as enum (
  'requested', 'accepted', 'ready', 'picked_up', 'declined', 'cancelled'
);

create table public.refill_request (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facility (id),
  service_id uuid not null references public.service (id),
  patient_id uuid not null references public.patient_profile (id),
  requested_by uuid not null references public.app_user (id),
  channel public.appointment_channel not null,
  status public.refill_status not null default 'requested',
  -- When the patient expects to need the refill.
  needed_by date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index refill_request_facility_status_idx on public.refill_request (facility_id, status, created_at);
create index refill_request_patient_id_idx on public.refill_request (patient_id);

create trigger refill_request_set_updated_at
  before update on public.refill_request
  for each row execute function public.set_updated_at();

-- Legal state changes, enforced for every caller.
--   reservation: reserved -> ready -> picked_up; reserved|ready -> cancelled|expired
--   refill:      requested -> accepted -> ready -> picked_up;
--                requested -> declined; requested|accepted|ready -> cancelled
create function public.pharmacy_guard_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from text := old.status::text;
  v_to text := new.status::text;
  v_ok boolean;
begin
  if v_from = v_to then
    return new;
  end if;
  if tg_table_name = 'reservation' then
    v_ok := (v_from = 'reserved' and v_to in ('ready', 'cancelled', 'expired'))
         or (v_from = 'ready' and v_to in ('picked_up', 'cancelled', 'expired'));
  else
    v_ok := (v_from = 'requested' and v_to in ('accepted', 'declined', 'cancelled'))
         or (v_from = 'accepted' and v_to in ('ready', 'cancelled'))
         or (v_from = 'ready' and v_to in ('picked_up', 'cancelled'));
  end if;
  if not v_ok then
    raise exception 'illegal_status_transition: % -> %', v_from, v_to using errcode = 'PH009';
  end if;
  return new;
end;
$$;

create trigger reservation_guard_transition
  before update of status on public.reservation
  for each row execute function public.pharmacy_guard_transition();

create trigger refill_request_guard_transition
  before update of status on public.refill_request
  for each row execute function public.pharmacy_guard_transition();

alter table public.reservation enable row level security;
alter table public.refill_request enable row level security;

create policy reservation_select on public.reservation
  for select to authenticated
  using (
    public.is_patient_self(patient_id)
    or public.has_circle_consent(patient_id, array['care_manager']::public.circle_role[])
    or (select public.can_manage_facility(facility_id))
  );

create policy reservation_update_managed on public.reservation
  for update to authenticated
  using ((select public.can_manage_facility(facility_id)))
  with check ((select public.can_manage_facility(facility_id)));

create policy refill_request_select on public.refill_request
  for select to authenticated
  using (
    public.is_patient_self(patient_id)
    or public.has_circle_consent(patient_id, array['care_manager']::public.circle_role[])
    or (select public.can_manage_facility(facility_id))
  );

create policy refill_request_update_managed on public.refill_request
  for update to authenticated
  using ((select public.can_manage_facility(facility_id)))
  with check ((select public.can_manage_facility(facility_id)));

-- ---------------------------------------------------------------------------
-- patient_profile: a facility's staff see the patients who have an
-- appointment, a reservation or a refill request with that facility.
-- ---------------------------------------------------------------------------
create policy patient_profile_select_facility on public.patient_profile
  for select to authenticated
  using (
    exists (
      select 1 from public.appointment a
      where a.patient_id = patient_profile.id and public.can_manage_facility(a.facility_id)
    )
    or exists (
      select 1 from public.reservation r
      where r.patient_id = patient_profile.id and public.can_manage_facility(r.facility_id)
    )
    or exists (
      select 1 from public.refill_request q
      where q.patient_id = patient_profile.id and public.can_manage_facility(q.facility_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Counter flows. Each is one transaction, service role only: register the
-- patient if new, record the consent they gave at the counter, then act.
-- ---------------------------------------------------------------------------
create function public.register_counter_patient(
  p_actor_id uuid,
  p_patient_id uuid,
  p_full_name text,
  p_phone text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_patient_id uuid := p_patient_id;
begin
  -- What follows is attributed to the acting account.
  perform set_config('app.actor_id', p_actor_id::text, true);

  if v_patient_id is null then
    if p_full_name is null or btrim(p_full_name) = '' then
      raise exception 'patient_name_required' using errcode = 'PH013';
    end if;
    insert into public.patient_profile (full_name, phone, created_by)
    values (btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''), p_actor_id)
    returning id into v_patient_id;
  end if;

  -- Consent given at the counter or on the phone, recorded before anything else.
  insert into public.access_log (actor_id, subject_patient_id, action, resource_type)
  values (p_actor_id, v_patient_id, 'counter_consent.record', 'patient_profile');

  return v_patient_id;
end;
$$;

-- book_walk_in gains home-service details; the old signature is replaced.
drop function public.book_walk_in(uuid, uuid, uuid, uuid, text, text);

create function public.book_walk_in(
  p_slot_id uuid,
  p_actor_id uuid,
  p_service_id uuid,
  p_patient_id uuid default null,
  p_full_name text default null,
  p_phone text default null,
  p_home_service boolean default false,
  p_home_address text default null,
  p_home_barangay_code text default null,
  p_home_landmark text default null
)
returns public.appointment
language plpgsql
set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_appointment public.appointment%rowtype;
begin
  if p_home_service and (p_home_address is null or btrim(p_home_address) = '') then
    raise exception 'home_address_required' using errcode = 'PH016';
  end if;

  v_patient_id := public.register_counter_patient(p_actor_id, p_patient_id, p_full_name, p_phone);

  v_appointment := public.book_slot(
    p_slot_id, v_patient_id, p_actor_id, 'assisted_counter', p_service_id, null, p_home_service
  );

  if p_home_service then
    insert into public.appointment_home_visit (appointment_id, address_line, barangay_code, landmark)
    values (
      v_appointment.id, btrim(p_home_address), p_home_barangay_code,
      nullif(btrim(coalesce(p_home_landmark, '')), '')
    );
  end if;

  insert into public.access_log (actor_id, subject_patient_id, action, resource_type, resource_id)
  values (p_actor_id, v_patient_id, 'appointment.create', 'appointment', v_appointment.id);

  return v_appointment;
end;
$$;

create function public.create_counter_reservation(
  p_facility_id uuid,
  p_actor_id uuid,
  p_service_id uuid,
  p_quantity integer,
  p_hold_until timestamptz,
  p_patient_id uuid default null,
  p_full_name text default null,
  p_phone text default null
)
returns public.reservation
language plpgsql
set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_reservation public.reservation%rowtype;
begin
  v_patient_id := public.register_counter_patient(p_actor_id, p_patient_id, p_full_name, p_phone);

  insert into public.reservation
    (facility_id, service_id, patient_id, reserved_by, channel, quantity, hold_until)
  values
    (p_facility_id, p_service_id, v_patient_id, p_actor_id, 'assisted_counter', p_quantity, p_hold_until)
  returning * into v_reservation;

  insert into public.access_log (actor_id, subject_patient_id, action, resource_type, resource_id)
  values (p_actor_id, v_patient_id, 'reservation.create', 'reservation', v_reservation.id);

  return v_reservation;
end;
$$;

create function public.create_counter_refill_request(
  p_facility_id uuid,
  p_actor_id uuid,
  p_service_id uuid,
  p_needed_by date,
  p_patient_id uuid default null,
  p_full_name text default null,
  p_phone text default null
)
returns public.refill_request
language plpgsql
set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_request public.refill_request%rowtype;
begin
  v_patient_id := public.register_counter_patient(p_actor_id, p_patient_id, p_full_name, p_phone);

  insert into public.refill_request
    (facility_id, service_id, patient_id, requested_by, channel, needed_by)
  values
    (p_facility_id, p_service_id, v_patient_id, p_actor_id, 'assisted_counter', p_needed_by)
  returning * into v_request;

  insert into public.access_log (actor_id, subject_patient_id, action, resource_type, resource_id)
  values (p_actor_id, v_patient_id, 'refill_request.create', 'refill_request', v_request.id);

  return v_request;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.register_counter_patient(uuid, uuid, text, text)',
    'public.book_walk_in(uuid, uuid, uuid, uuid, text, text, boolean, text, text, text)',
    'public.create_counter_reservation(uuid, uuid, uuid, integer, timestamptz, uuid, text, text)',
    'public.create_counter_refill_request(uuid, uuid, uuid, date, uuid, text, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- vault_document: a file released to a patient's health vault (a lab result,
-- a prescription, a consult summary). The platform stores and delivers the
-- document; it does not read or interpret it. The file itself lives in the
-- private `vault` storage bucket (0014) and is only ever served through a
-- short-lived signed URL.
-- ---------------------------------------------------------------------------
create type public.vault_document_type as enum (
  'lab_result', 'imaging_result', 'prescription', 'consult_summary', 'other'
);

create table public.vault_document (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_profile (id),
  document_type public.vault_document_type not null,
  -- '<facility_id>/<document id>': no patient identifier in the path.
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0),
  appointment_id uuid references public.appointment (id),
  facility_id uuid references public.facility (id),
  uploaded_by uuid not null references public.app_user (id),
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index vault_document_patient_id_idx on public.vault_document (patient_id, released_at desc);
create index vault_document_facility_id_idx on public.vault_document (facility_id, released_at desc);

alter table public.vault_document enable row level security;

create policy vault_document_select on public.vault_document
  for select to authenticated
  using (
    public.is_patient_self(patient_id)
    or public.has_circle_consent(patient_id, array['care_manager']::public.circle_role[])
    or (select public.can_manage_facility(facility_id))
  );

-- A facility delivers a result only for an appointment that patient had with it.
create policy vault_document_insert_managed on public.vault_document
  for insert to authenticated
  with check (
    (select public.can_manage_facility(facility_id))
    and uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.appointment a
      where a.id = appointment_id
        and a.patient_id = vault_document.patient_id
        and a.facility_id = vault_document.facility_id
    )
  );

-- The facility id a vault storage path belongs to, or null if the path is
-- not of the form '<facility uuid>/<file>'. Used by the storage policies.
create function public.vault_path_facility(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- PSGC place names are public reference data (barangay pickers, addresses).
create policy location_select_authenticated on public.location
  for select to authenticated
  using (true);
