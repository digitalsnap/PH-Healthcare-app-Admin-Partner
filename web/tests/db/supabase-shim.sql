-- TEST ONLY. Never part of the real migrations.
--
-- A plain PostGIS container has none of the things a Supabase project
-- provides. This recreates the minimum the migrations depend on: the auth
-- schema, auth.uid(), the three API roles and their default grants.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid()
);

-- Supabase reads the user id from the request's JWT. Tests set the legacy
-- per-claim setting directly; PostgREST sets the JSON claims object.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

-- Supabase ships an `extensions` schema the API roles can use.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges to the API roles by default and relies on
-- row-level security to restrict them. Mirror that, so the RLS tests prove
-- the policies rather than a missing grant.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Supabase Storage keeps its metadata in the storage schema; the vault
-- policies are written against storage.objects. This is the minimum shape
-- those policies need, so they can be tested without the Storage service.
create schema storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
