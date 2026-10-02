-- 0004: coverage programs and facility accreditation.

create type public.coverage_program_type as enum (
  'philhealth_yakap',
  'gamot',
  'hmo_plan',
  'senior_discount',
  'pwd_discount',
  'assistance_program'
);

create table public.coverage_program (
  id uuid primary key default gen_random_uuid(),
  program_type public.coverage_program_type not null,
  code text not null unique,
  name text not null,
  -- The stacking engine reads rules for a given version; rules never change
  -- in place without a new rules_version.
  rules_version text not null,
  rules jsonb not null default '{}'::jsonb,
  -- Every program page carries a source link and a review date.
  source_url text not null check (source_url ~ '^https?://'),
  last_reviewed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger coverage_program_set_updated_at
  before update on public.coverage_program
  for each row execute function public.set_updated_at();

create table public.accreditation (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facility (id) on delete cascade,
  coverage_program_id uuid not null references public.coverage_program (id),
  valid_from date not null,
  valid_to date,
  -- Where the accreditation was read from (official list, facility document).
  source text not null,
  source_url text check (source_url ~ '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accreditation_dates_ordered check (valid_to is null or valid_to >= valid_from),
  unique (facility_id, coverage_program_id, valid_from)
);

create index accreditation_coverage_program_id_idx on public.accreditation (coverage_program_id);

create trigger accreditation_set_updated_at
  before update on public.accreditation
  for each row execute function public.set_updated_at();
