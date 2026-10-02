-- 0001: extensions and shared helpers.
--
-- Conventions for every migration in this directory (see CLAUDE.md §7):
--   * snake_case names, UUID primary keys.
--   * Money is integer centavos (bigint), currency PHP. Never numeric/float.
--   * Every timestamp is timestamptz, stored in UTC, rendered in Asia/Manila.
--   * Locations carry PSGC codes plus a PostGIS point.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- Keeps updated_at honest without relying on the application.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- For audit tables (appointment_event, access_log): rows are written once and
-- never changed or removed.
create function public.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'PH004';
end;
$$;
