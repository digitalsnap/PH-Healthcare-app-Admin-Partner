-- 0014: the private storage bucket behind the health vault.
--
-- Files are never public. The bucket is private, uploads and reads go through
-- the caller's own session (so these policies apply), and a file is only ever
-- handed out as a short-lived signed URL.

insert into storage.buckets (id, name, public)
values ('vault', 'vault', false)
on conflict (id) do nothing;

-- A facility's staff may add files under their own facility's folder...
create policy vault_objects_insert_managed on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vault'
    and public.can_manage_facility(public.vault_path_facility(name))
  );

-- ...read them back (needed to sign a URL)...
create policy vault_objects_select_managed on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vault'
    and public.can_manage_facility(public.vault_path_facility(name))
  );

-- ...and remove one whose vault_document row could not be written.
create policy vault_objects_delete_managed on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vault'
    and public.can_manage_facility(public.vault_path_facility(name))
    and not exists (select 1 from public.vault_document d where d.storage_path = name)
  );
