-- 0010: what the admin console needs on top of the foundation.

-- ---------------------------------------------------------------------------
-- stock_report: a pharmacy's stock flag for one medicine at one moment.
-- The data-freshness dashboard counts pharmacies with no report in 7 days.
-- Pharmacies and patients write these from their own surfaces later.
-- ---------------------------------------------------------------------------
create type public.stock_reporter_type as enum ('pharmacy', 'patient', 'staff');

create table public.stock_report (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facility (id) on delete cascade,
  -- A service row of type 'medicine'.
  service_id uuid not null references public.service (id),
  available boolean not null,
  reporter_type public.stock_reporter_type not null,
  reported_by uuid references public.app_user (id),
  reported_at timestamptz not null default now()
);

create index stock_report_facility_reported_at_idx
  on public.stock_report (facility_id, reported_at desc);

alter table public.stock_report enable row level security;

create policy staff_all on public.stock_report
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

-- ---------------------------------------------------------------------------
-- facility_admin_view: one row per facility with the freshness facts the
-- console filters and counts on. security_invoker, so the caller's row-level
-- security on the underlying tables still applies.
-- ---------------------------------------------------------------------------
create view public.facility_admin_view
with (security_invoker = true) as
select
  f.id,
  f.parent_org_id,
  f.name,
  f.facility_type,
  f.region_code,
  f.province_code,
  f.municipality_code,
  m.name as municipality_name,
  f.barangay_code,
  b.name as barangay_name,
  f.address_line,
  f.phone,
  extensions.st_y(f.geog::extensions.geometry) as latitude,
  extensions.st_x(f.geog::extensions.geometry) as longitude,
  f.licences,
  f.hours,
  f.verification_status,
  f.last_verified_at,
  f.last_verified_by,
  f.created_at,
  f.updated_at,
  (select count(*) from public.price_item p where p.facility_id = f.id) as price_item_count,
  (select max(s.reported_at) from public.stock_report s where s.facility_id = f.id)
    as last_stock_report_at
from public.facility f
left join public.location m on m.psgc_code = f.municipality_code
left join public.location b on b.psgc_code = f.barangay_code;

-- ---------------------------------------------------------------------------
-- access_log: the internal team records its own actions. A row can only be
-- written under the caller's own identity; the table stays append-only.
-- ---------------------------------------------------------------------------
create policy access_log_staff_insert on public.access_log
  for insert to authenticated
  with check (actor_id = (select auth.uid()) and (select public.is_staff()));
