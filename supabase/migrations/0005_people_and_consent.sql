-- 0005: patients, care circles, consent and the access log.
--
-- Health data is sensitive personal information under RA 10173. RLS for these
-- tables is in 0009.

-- ---------------------------------------------------------------------------
-- patient_profile: the patient record. May exist without an app_user (a parent
-- who never installs the app, a walk-in booked at a counter).
-- ---------------------------------------------------------------------------
create table public.patient_profile (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid unique references public.app_user (id) on delete set null,
  full_name text not null,
  birth_date date,
  phone text,
  municipality_code text references public.location (psgc_code),
  barangay_code text references public.location (psgc_code),
  -- Patient-entered unless an official data connection exists; the API labels
  -- them as such.
  yakap_facility_id uuid references public.facility (id),
  gamot_balance_centavos bigint check (gamot_balance_centavos >= 0),
  gamot_balance_as_of timestamptz,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger patient_profile_set_updated_at
  before update on public.patient_profile
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- care_circle and circle_membership
-- ---------------------------------------------------------------------------
create table public.care_circle (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patient_profile (id) on delete cascade,
  created_at timestamptz not null default now()
);

create type public.circle_role as enum ('patient', 'care_manager', 'payer', 'viewer');

create type public.consent_method as enum (
  'otp_patient_phone',
  'in_person_partner_facility',
  'guardian_documented'
);

-- A membership row on its own is only a relationship (an invitation). It
-- grants nothing until the patient's consent is recorded: consent_method and
-- granted_at set, revoked_at null. Policies and server code must check that
-- through has_circle_consent(), never the mere existence of the row.
create table public.circle_membership (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.care_circle (id) on delete cascade,
  member_user_id uuid not null references public.app_user (id) on delete cascade,
  role public.circle_role not null,
  consent_method public.consent_method,
  granted_at timestamptz,
  revoked_at timestamptz,
  -- Joining a teleconsult is a separate permission the patient grants.
  can_join_teleconsult boolean not null default false,
  invited_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  constraint circle_membership_consent_recorded_whole check (
    (granted_at is null) = (consent_method is null)
  ),
  constraint circle_membership_revoke_after_grant check (
    revoked_at is null or (granted_at is not null and revoked_at >= granted_at)
  )
);

create unique index circle_membership_one_open_per_member
  on public.circle_membership (circle_id, member_user_id)
  where revoked_at is null;

create index circle_membership_member_user_id_idx on public.circle_membership (member_user_id);

-- True when the caller is the patient's own account.
create function public.is_patient_self(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.patient_profile p
    where p.id = p_patient_id and p.app_user_id = (select auth.uid())
  );
$$;

-- True only when the patient's consent for the caller is recorded and not
-- revoked, for one of the given roles.
create function public.has_circle_consent(p_patient_id uuid, p_roles public.circle_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circle_membership m
    join public.care_circle c on c.id = m.circle_id
    where c.patient_id = p_patient_id
      and m.member_user_id = (select auth.uid())
      and m.role = any (p_roles)
      and m.consent_method is not null
      and m.granted_at is not null
      and m.granted_at <= now()
      and m.revoked_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- access_log: every read or change of patient data. Append-only.
-- Never put names, phone numbers or health details in action or resource_type.
-- ---------------------------------------------------------------------------
create table public.access_log (
  id uuid primary key default gen_random_uuid(),
  -- Null actor = system job.
  actor_id uuid references public.app_user (id),
  subject_patient_id uuid references public.patient_profile (id),
  -- e.g. 'patient_profile.read', 'appointment.create', 'counter_consent.record'
  action text not null,
  resource_type text,
  resource_id uuid,
  at timestamptz not null default now()
);

create index access_log_subject_patient_at_idx on public.access_log (subject_patient_id, at desc);
create index access_log_actor_at_idx on public.access_log (actor_id, at desc);

create trigger access_log_append_only
  before update or delete on public.access_log
  for each row execute function public.forbid_mutation();
