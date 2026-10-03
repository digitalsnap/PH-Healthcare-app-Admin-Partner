-- 0015: withdrawing a wrongly delivered result (with admin approval), and
-- the groundwork for an SMS carrier.

-- ---------------------------------------------------------------------------
-- vault_document withdrawal.
--
-- A facility that delivered the wrong file asks for it to be withdrawn. From
-- that moment the patient no longer sees the document. The internal team then
-- approves (the file is removed from storage) or rejects (the document is
-- visible to the patient again). The row itself is kept either way.
-- ---------------------------------------------------------------------------
create type public.vault_withdrawal_status as enum ('requested', 'approved', 'rejected');
create type public.vault_withdrawal_reason as enum ('wrong_patient', 'wrong_file', 'duplicate', 'other');

alter table public.vault_document
  add column withdrawal_status public.vault_withdrawal_status,
  add column withdrawal_reason public.vault_withdrawal_reason,
  add column withdrawal_requested_at timestamptz,
  add column withdrawal_requested_by uuid references public.app_user (id),
  add column withdrawal_decided_at timestamptz,
  add column withdrawal_decided_by uuid references public.app_user (id),
  -- Set once the stored file has actually been deleted after an approval.
  add column file_removed_at timestamptz,
  -- Set instead when an admin closed the withdrawal by hand because storage
  -- could not confirm the deletion. Who did it is kept.
  add column file_removal_override_by uuid references public.app_user (id),
  add constraint vault_document_withdrawal_request_whole check (
    (withdrawal_status is null)
    = (withdrawal_reason is null and withdrawal_requested_at is null and withdrawal_requested_by is null)
  ),
  add constraint vault_document_withdrawal_decision_whole check (
    (withdrawal_status in ('approved', 'rejected'))
    = (withdrawal_decided_at is not null and withdrawal_decided_by is not null)
  ),
  add constraint vault_document_file_removed_only_when_approved check (
    file_removed_at is null or withdrawal_status = 'approved'
  ),
  add constraint vault_document_override_closes_removal check (
    file_removal_override_by is null or file_removed_at is not null
  );

create index vault_document_withdrawal_idx
  on public.vault_document (withdrawal_status, withdrawal_requested_at)
  where withdrawal_status is not null;

-- The patient (and a consented care manager) stop seeing a document as soon
-- as its withdrawal is requested, and see it again only if that is rejected.
-- The facility always sees its own deliveries and their withdrawal state.
drop policy vault_document_select on public.vault_document;

create policy vault_document_select on public.vault_document
  for select to authenticated
  using (
    (
      (withdrawal_status is null or withdrawal_status = 'rejected')
      and (
        public.is_patient_self(patient_id)
        or public.has_circle_consent(patient_id, array['care_manager']::public.circle_role[])
      )
    )
    or (select public.can_manage_facility(facility_id))
  );

-- The internal team sees a document only once its withdrawal has been
-- requested, and only to decide on it.
create policy vault_document_staff_select on public.vault_document
  for select to authenticated
  using (withdrawal_status is not null and (select public.is_staff()));

create policy vault_document_staff_decide on public.vault_document
  for update to authenticated
  using (withdrawal_status is not null and (select public.is_staff()))
  with check (withdrawal_status is not null and (select public.is_staff()));

create policy vault_document_request_withdrawal on public.vault_document
  for update to authenticated
  using ((select public.can_manage_facility(facility_id)))
  with check ((select public.can_manage_facility(facility_id)));

-- What each caller may change, whatever the UI sends:
--   facility staff: only "no withdrawal" -> requested, as themselves
--   internal team:  only requested -> approved | rejected (and recording that
--                   the file was removed after an approval)
--   admins only:    closing an approved withdrawal by hand when storage cannot
--                   confirm the deletion, under their own name
--   nobody:         the document itself
create function public.vault_document_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Server jobs using the service role.
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.patient_id is distinct from old.patient_id
     or new.document_type is distinct from old.document_type
     or new.storage_path is distinct from old.storage_path
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.appointment_id is distinct from old.appointment_id
     or new.facility_id is distinct from old.facility_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.released_at is distinct from old.released_at then
    raise exception 'vault_document_is_immutable' using errcode = 'PH017';
  end if;

  if (select public.is_staff()) then
    if old.withdrawal_status = 'requested' and new.withdrawal_status in ('approved', 'rejected') then
      if new.withdrawal_decided_by is distinct from (select auth.uid())
         or new.file_removal_override_by is not null
         or new.withdrawal_reason is distinct from old.withdrawal_reason
         or new.withdrawal_requested_by is distinct from old.withdrawal_requested_by
         or new.withdrawal_requested_at is distinct from old.withdrawal_requested_at then
        raise exception 'illegal_withdrawal_change' using errcode = 'PH018';
      end if;
      return new;
    end if;
    -- After an approval, the only further change is noting the file is gone.
    if old.withdrawal_status = 'approved' and new.withdrawal_status = 'approved'
       and old.file_removed_at is null and new.file_removed_at is not null then
      -- An override is an admin's call, not field staff's, and is signed.
      if new.file_removal_override_by is not null and (
        new.file_removal_override_by is distinct from (select auth.uid())
        or (select public.current_app_role()) is distinct from 'admin'
      ) then
        raise exception 'override_requires_admin' using errcode = 'PH019';
      end if;
      return new;
    end if;
    raise exception 'illegal_withdrawal_change' using errcode = 'PH018';
  end if;

  if old.withdrawal_status is null
     and new.withdrawal_status = 'requested'
     and new.withdrawal_requested_by = (select auth.uid())
     and new.withdrawal_decided_at is null
     and new.file_removed_at is null
     and new.file_removal_override_by is null then
    return new;
  end if;
  raise exception 'illegal_withdrawal_change' using errcode = 'PH018';
end;
$$;

create trigger vault_document_guard
  before update on public.vault_document
  for each row execute function public.vault_document_guard();

-- ---------------------------------------------------------------------------
-- SMS: ready for a carrier.
--
-- The outbox already holds appointment messages. These changes let a sender
-- job take due messages safely (two jobs never send the same one), record the
-- outcome, and retry a failure a limited number of times. Templates for
-- reservations and refills are added so those can be queued later; nothing
-- queues them yet.
-- ---------------------------------------------------------------------------
alter type public.sms_template add value if not exists 'reservation_ready';
alter type public.sms_template add value if not exists 'reservation_cancelled';
alter type public.sms_template add value if not exists 'refill_ready';
alter type public.sms_template add value if not exists 'refill_declined';

alter table public.sms_message
  add column reservation_id uuid references public.reservation (id),
  add column refill_request_id uuid references public.refill_request (id),
  add column attempts integer not null default 0,
  add column claimed_at timestamptz,
  add column last_error text;

-- How many times a message is tried before it is marked failed.
create function public.sms_max_attempts()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3 $$;

-- Hands out due messages to one sender. SKIP LOCKED means a second sender
-- running at the same time takes different rows; a claim that was never
-- completed (the sender died) becomes available again after ten minutes.
create function public.claim_due_sms(p_limit integer)
returns setof public.sms_message
language plpgsql
set search_path = ''
as $$
begin
  return query
  update public.sms_message m
  set claimed_at = now(), attempts = m.attempts + 1
  where m.id in (
    select q.id
    from public.sms_message q
    where q.status = 'queued'
      and q.scheduled_at <= now()
      and (q.claimed_at is null or q.claimed_at < now() - interval '10 minutes')
    order by q.scheduled_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning m.*;
end;
$$;

-- Records what the carrier said. A retryable failure goes back in the queue
-- until the attempts run out. last_error is a short carrier code, never the
-- message body or the phone number.
create function public.complete_sms(
  p_id uuid,
  p_sent boolean,
  p_provider_ref text default null,
  p_error text default null,
  p_retryable boolean default true
)
returns public.sms_status
language plpgsql
set search_path = ''
as $$
declare
  v_status public.sms_status;
begin
  update public.sms_message m
  set status = case
        when p_sent then 'sent'::public.sms_status
        when p_retryable and m.attempts < public.sms_max_attempts() then 'queued'::public.sms_status
        else 'failed'::public.sms_status
      end,
      sent_at = case when p_sent then now() else null end,
      provider_ref = case when p_sent then p_provider_ref else m.provider_ref end,
      last_error = case when p_sent then null else left(p_error, 200) end,
      claimed_at = null
  where m.id = p_id and m.status = 'queued'
  returning m.status into v_status;
  return v_status;
end;
$$;

revoke execute on function public.claim_due_sms(integer) from public, anon, authenticated;
grant execute on function public.claim_due_sms(integer) to service_role;
revoke execute on function public.complete_sms(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_sms(uuid, boolean, text, text, boolean) to service_role;
