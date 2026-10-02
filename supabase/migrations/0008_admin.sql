-- 0008: admin console work tables.

create type public.verification_subject as enum (
  'facility', 'practitioner', 'price_item', 'accreditation'
);

create type public.verification_task_status as enum ('open', 'in_progress', 'done', 'rejected');

-- The verification work queue (PRC, DOH/FDA licences, accreditation, prices).
create table public.verification_task (
  id uuid primary key default gen_random_uuid(),
  subject_type public.verification_subject not null,
  subject_id uuid not null,
  status public.verification_task_status not null default 'open',
  assigned_to uuid references public.app_user (id),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.app_user (id),
  notes text,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verification_task_completion_recorded_whole check (
    (status in ('done', 'rejected')) = (completed_at is not null and completed_by is not null)
  )
);

create index verification_task_queue_idx on public.verification_task (status, due_at);
create index verification_task_subject_idx on public.verification_task (subject_type, subject_id);

create trigger verification_task_set_updated_at
  before update on public.verification_task
  for each row execute function public.set_updated_at();

create type public.data_import_status as enum ('pending', 'running', 'completed', 'failed');

-- Imports of public data (facility registry, accreditation lists). Never
-- patient data.
create table public.data_source_import (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_url text check (source_url ~ '^https?://'),
  target_table text not null,
  status public.data_import_status not null default 'pending',
  row_count integer check (row_count >= 0),
  imported_count integer check (imported_count >= 0),
  error_count integer check (error_count >= 0),
  -- Path in private storage; fetched through a short-lived signed URL.
  file_ref text,
  started_at timestamptz,
  finished_at timestamptz,
  imported_by uuid references public.app_user (id),
  created_at timestamptz not null default now()
);
