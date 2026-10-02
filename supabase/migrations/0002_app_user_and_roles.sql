-- 0002: auth identity and console roles.
--
-- One auth system (Supabase auth), role on the account. app_user is the login
-- identity; it is deliberately separate from patient_profile (0005), because a
-- patient may exist without ever having an account.

create type public.app_role as enum ('admin', 'staff', 'doctor', 'provider_staff');

create table public.app_user (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Null means an ordinary app account (patient or family member) with no
  -- access to any web console. Only the four console roles exist here.
  role public.app_role,
  display_name text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_user_set_updated_at
  before update on public.app_user
  for each row execute function public.set_updated_at();

-- Role of the calling account. SECURITY DEFINER so RLS policies can call it
-- without recursing into app_user's own policies.
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.app_user u
  where u.id = (select auth.uid()) and u.is_active;
$$;

-- Internal team: admins and field staff.
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'staff'), false);
$$;

-- Actor for audit rows. Server code using the service role sets app.actor_id
-- for the transaction; otherwise fall back to the signed-in account.
create function public.app_actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('app.actor_id', true), '')::uuid,
    (select auth.uid())
  );
$$;
