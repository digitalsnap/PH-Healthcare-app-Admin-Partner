-- 0003: geography and supply.

-- ---------------------------------------------------------------------------
-- location: the PSGC hierarchy. Cities sit at the municipality level.
-- ---------------------------------------------------------------------------
create type public.location_level as enum ('region', 'province', 'municipality', 'barangay');

create table public.location (
  id uuid primary key default gen_random_uuid(),
  psgc_code text not null unique check (psgc_code ~ '^[0-9]{10}$'),
  level public.location_level not null,
  name text not null,
  region_code text not null check (region_code ~ '^[0-9]{10}$'),
  -- Nullable below region: some cities (HUCs, NCR) have no province.
  province_code text check (province_code ~ '^[0-9]{10}$'),
  municipality_code text check (municipality_code ~ '^[0-9]{10}$'),
  barangay_code text check (barangay_code ~ '^[0-9]{10}$'),
  centroid extensions.geography(point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_level_matches_codes check (
    case level
      when 'region' then psgc_code = region_code
        and province_code is null and municipality_code is null and barangay_code is null
      when 'province' then psgc_code = province_code
        and municipality_code is null and barangay_code is null
      when 'municipality' then psgc_code = municipality_code and barangay_code is null
      when 'barangay' then psgc_code = barangay_code and municipality_code is not null
    end
  )
);

create index location_municipality_code_idx on public.location (municipality_code);
create index location_province_code_idx on public.location (province_code);

create trigger location_set_updated_at
  before update on public.location
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organization: parent of a chain's branches (facility.parent_org_id).
-- ---------------------------------------------------------------------------
create table public.organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organization_set_updated_at
  before update on public.organization
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- facility
-- ---------------------------------------------------------------------------
create type public.facility_type as enum (
  'yakap_clinic',
  'diagnostic_center',
  'pharmacy',
  'hospital_public',
  'hospital_private',
  'rhu',
  'health_center',
  'barangay_health_station',
  'private_clinic'
);

create type public.verification_status as enum (
  'unverified', 'pending', 'verified', 'rejected', 'suspended'
);

create table public.facility (
  id uuid primary key default gen_random_uuid(),
  parent_org_id uuid references public.organization (id),
  name text not null,
  facility_type public.facility_type not null,
  region_code text not null references public.location (psgc_code),
  province_code text references public.location (psgc_code),
  municipality_code text not null references public.location (psgc_code),
  barangay_code text references public.location (psgc_code),
  address_line text,
  geog extensions.geography(point, 4326),
  phone text,
  -- [{ "kind": "doh_lto" | "fda_lto" | ..., "number": "...", "expires_on": "YYYY-MM-DD" }]
  licences jsonb not null default '[]'::jsonb check (jsonb_typeof(licences) = 'array'),
  -- Opening hours keyed by ISO weekday, wall-clock in Asia/Manila.
  hours jsonb not null default '{}'::jsonb check (jsonb_typeof(hours) = 'object'),
  verification_status public.verification_status not null default 'unverified',
  last_verified_at timestamptz,
  last_verified_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Every listing shows last_verified_at, so "verified" without a date is invalid.
  constraint facility_verified_has_date check (
    verification_status <> 'verified' or last_verified_at is not null
  )
);

create index facility_geog_idx on public.facility using gist (geog);
create index facility_municipality_code_idx on public.facility (municipality_code);
create index facility_type_idx on public.facility (facility_type);
create index facility_parent_org_id_idx on public.facility (parent_org_id);

create trigger facility_set_updated_at
  before update on public.facility
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- practitioner
-- ---------------------------------------------------------------------------
create table public.practitioner (
  id uuid primary key default gen_random_uuid(),
  -- The doctor's login, once they have claimed the profile.
  app_user_id uuid unique references public.app_user (id) on delete set null,
  full_name text not null,
  prc_number text unique,
  prc_licence_expires_on date,
  specialties text[] not null default '{}',
  prc_verified_at timestamptz,
  prc_verified_by uuid references public.app_user (id),
  is_live boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- PRC verification is recorded whole or not at all: number, verifier, time
  -- and licence expiry.
  constraint practitioner_prc_verification_complete check (
    (prc_verified_at is null and prc_verified_by is null)
    or (
      prc_verified_at is not null
      and prc_verified_by is not null
      and prc_number is not null
      and prc_licence_expires_on is not null
    )
  ),
  -- A profile goes live only after PRC verification is recorded.
  constraint practitioner_live_requires_prc check (not is_live or prc_verified_at is not null)
);

create trigger practitioner_set_updated_at
  before update on public.practitioner
  for each row execute function public.set_updated_at();

create table public.practitioner_facility (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner (id) on delete cascade,
  facility_id uuid not null references public.facility (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (practitioner_id, facility_id)
);

create index practitioner_facility_facility_id_idx on public.practitioner_facility (facility_id);

-- ---------------------------------------------------------------------------
-- service, service_prep, price_item
-- ---------------------------------------------------------------------------
create type public.service_type as enum ('consult', 'lab_test', 'imaging', 'procedure', 'medicine');

create table public.service (
  id uuid primary key default gen_random_uuid(),
  service_type public.service_type not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_type, name)
);

create trigger service_set_updated_at
  before update on public.service
  for each row execute function public.set_updated_at();

-- Preparation instructions per test (fasting, timing, what to bring). A row
-- with facility_id null is the default; a facility may override it.
create table public.service_prep (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service (id) on delete cascade,
  facility_id uuid references public.facility (id) on delete cascade,
  locale text not null check (locale in ('en', 'fil')),
  instructions text not null,
  fasting_hours integer check (fasting_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (service_id, facility_id, locale)
);

create trigger service_prep_set_updated_at
  before update on public.service_prep
  for each row execute function public.set_updated_at();

create type public.price_source as enum ('facility_confirmed', 'patient_reported', 'estimated');

create table public.price_item (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service (id),
  facility_id uuid not null references public.facility (id) on delete cascade,
  -- Integer centavos, PHP. Always a range; min = max is allowed only as data,
  -- the API still presents a range with a source label and disclaimer.
  amount_min_centavos bigint not null check (amount_min_centavos >= 0),
  amount_max_centavos bigint not null,
  source public.price_source not null,
  -- facility_confirmed: date confirmed. patient_reported: latest report date.
  observed_at timestamptz not null,
  -- patient_reported carries a count alongside the latest date.
  report_count integer check (report_count >= 1),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_item_range_ordered check (amount_max_centavos >= amount_min_centavos),
  constraint price_item_patient_reported_has_count check (
    (source = 'patient_reported') = (report_count is not null)
  )
);

create index price_item_facility_service_idx on public.price_item (facility_id, service_id);
create index price_item_service_id_idx on public.price_item (service_id);

create trigger price_item_set_updated_at
  before update on public.price_item
  for each row execute function public.set_updated_at();
