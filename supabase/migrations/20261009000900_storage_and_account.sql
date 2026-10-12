-- Private storage buckets; objects live under {user_id}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('resumes', 'resumes', false, 10485760, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('exports', 'exports', false, 10485760, array['application/pdf']),
  ('audio', 'audio', false, 26214400, array['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm'])
on conflict (id) do nothing;

create policy storage_own_read on storage.objects for select to authenticated
  using (bucket_id in ('resumes', 'exports', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_own_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('resumes', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_own_delete on storage.objects for delete to authenticated
  using (bucket_id in ('resumes', 'exports', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Account deletion (required by App Store and Play). Storage objects are removed by
-- the delete-account function before this runs; rows cascade from auth.users.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  insert into audit.events (actor, action, subject) values ('user', 'account.delete', v_uid::text);
  delete from auth.users where id = v_uid;
end $$;
revoke execute on function public.delete_my_account from public, anon;
grant execute on function public.delete_my_account to authenticated;
