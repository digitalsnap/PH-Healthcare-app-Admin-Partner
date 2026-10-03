-- 0012: affiliations need admin approval, and an unverified doctor can ask
-- for PRC verification.

-- ---------------------------------------------------------------------------
-- practitioner_facility: a doctor requests an affiliation; the internal team
-- approves or rejects it. Only an approved affiliation can carry a schedule.
-- ---------------------------------------------------------------------------
create type public.affiliation_status as enum ('pending', 'approved', 'rejected');

alter table public.practitioner_facility
  add column status public.affiliation_status not null default 'pending',
  add column requested_at timestamptz not null default now(),
  add column decided_at timestamptz,
  add column decided_by uuid references public.app_user (id),
  add constraint practitioner_facility_decision_recorded_whole check (
    (status = 'pending') = (decided_at is null and decided_by is null)
  );

create index practitioner_facility_status_idx on public.practitioner_facility (status, requested_at);

-- A doctor may see their affiliations, request one (always as pending) and
-- withdraw one. They can never approve their own request: there is no update
-- policy for them.
drop policy practitioner_facility_own on public.practitioner_facility;

create policy practitioner_facility_select_own on public.practitioner_facility
  for select to authenticated
  using (practitioner_id = (select public.own_practitioner_id()));

create policy practitioner_facility_request_own on public.practitioner_facility
  for insert to authenticated
  with check (
    practitioner_id = (select public.own_practitioner_id())
    and status = 'pending'
    and decided_at is null
    and decided_by is null
  );

create policy practitioner_facility_delete_own on public.practitioner_facility
  for delete to authenticated
  using (practitioner_id = (select public.own_practitioner_id()));

-- A doctor's schedule at a clinic needs an approved affiliation with it.
drop policy schedule_own on public.schedule;

create policy schedule_own on public.schedule
  for all to authenticated
  using (practitioner_id = (select public.own_practitioner_id()))
  with check (
    practitioner_id = (select public.own_practitioner_id())
    and exists (
      select 1 from public.practitioner_facility pf
      where pf.practitioner_id = schedule.practitioner_id
        and pf.facility_id = schedule.facility_id
        and pf.status = 'approved'
    )
  );

-- ---------------------------------------------------------------------------
-- practitioner: when a doctor without PRC verification tries to publish, the
-- attempt is still refused, and this records that they are asking to be
-- verified so the internal team sees it in their queue.
-- ---------------------------------------------------------------------------
alter table public.practitioner
  add column verification_requested_at timestamptz;
