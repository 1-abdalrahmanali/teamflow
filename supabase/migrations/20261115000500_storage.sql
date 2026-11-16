-- TeamFlow 0005: file storage.
-- "submissions" is private: files for File Upload tasks, at <task id>/<user id>/<file>.
-- "avatars" is public-read: profile pictures, at <user id>/<file>.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('submissions', 'submissions', false, 10485760),  -- 10 MB per file
  ('avatars', 'avatars', true, 2097152)             -- 2 MB per file
on conflict (id) do nothing;

-- Folder names arrive as text from the client; a malformed one must fail closed, not error.
create function private.uuid_or_null(p_value text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end $$;

create function private.is_file_task_assignee(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks
    where id = p_task_id and assigned_to = (select auth.uid()) and submission_type = 'file_upload'
  )
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Submission files: the assignee uploads into their own folder under their own task.
create policy "submission files: assignee uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.is_file_task_assignee(private.uuid_or_null((storage.foldername(name))[1]))
  );

-- Read by the author (while still in the project) and by the project owner.
create policy "submission files: author and project owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (
      (
        (storage.foldername(name))[2] = (select auth.uid())::text
        and private.is_task_project_member(private.uuid_or_null((storage.foldername(name))[1]))
      )
      or private.owns_task(private.uuid_or_null((storage.foldername(name))[1]))
    )
  );

-- Avatars: each person manages only their own folder. Reading goes through the public URL.
create policy "avatars: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
