-- TeamFlow v2, 0700: file storage.
--   submissions     private, 10 MB, <task id>/<user id>/<file>      files handed in for File tasks
--   task-resources  private, 20 MB, <project id>/<task id>/<file>   learning resources and attachments
--   avatars         public,   2 MB, <user id>/<file>                profile photos

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('submissions', 'submissions', false, 10485760, null),
  ('task-resources', 'task-resources', false, 20971520, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css', 'text/javascript', 'application/json',
    'application/zip', 'application/x-zip-compressed', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]),
  ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

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
    where id = p_task_id and assigned_to = (select auth.uid()) and submission_type = 'file'
  ) and private.task_is_active(p_task_id)
$$;

-- True when <project>/<task>/ in a resource path really names that task in that project.
create function private.resource_folder_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.task_project(private.uuid_or_null((storage.foldername(p_name))[2]))
         = private.uuid_or_null((storage.foldername(p_name))[1])
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Policies from an earlier version, if present, are replaced.
drop policy if exists "submission files: assignee uploads" on storage.objects;
drop policy if exists "submission files: author and project owner read" on storage.objects;
drop policy if exists "submission files: author and managers read" on storage.objects;
drop policy if exists "resource files: managers upload" on storage.objects;
drop policy if exists "resource files: read with the task" on storage.objects;
drop policy if exists "resource files: managers delete" on storage.objects;
drop policy if exists "avatars: read own folder" on storage.objects;
drop policy if exists "avatars: upload to own folder" on storage.objects;
drop policy if exists "avatars: replace own" on storage.objects;
drop policy if exists "avatars: delete own" on storage.objects;

-- Submission files: the assignee uploads into their own folder on their own File task.
create policy "submission files: assignee uploads" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.is_file_task_assignee(private.uuid_or_null((storage.foldername(name))[1]))
  );

create policy "submission files: author and managers read" on storage.objects for select to authenticated
  using (
    bucket_id = 'submissions'
    and (
      ((storage.foldername(name))[2] = (select auth.uid())::text
        and private.is_project_member(private.task_project(private.uuid_or_null((storage.foldername(name))[1]))))
      or private.can_manage_task(private.uuid_or_null((storage.foldername(name))[1]))
    )
  );

-- Resource files: managers upload and delete; anyone who can open the task reads.
create policy "resource files: managers upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-resources'
    and private.resource_folder_ok(name)
    and private.can_manage_task(private.uuid_or_null((storage.foldername(name))[2]))
    and private.task_is_active(private.uuid_or_null((storage.foldername(name))[2]))
  );

create policy "resource files: read with the task" on storage.objects for select to authenticated
  using (
    bucket_id = 'task-resources'
    and private.resource_folder_ok(name)
    and private.can_access_task(private.uuid_or_null((storage.foldername(name))[2]))
  );

create policy "resource files: managers delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-resources'
    and private.resource_folder_ok(name)
    and private.can_manage_task(private.uuid_or_null((storage.foldername(name))[2]))
  );

-- Avatars: each person manages only their own folder. Reading goes through the public URL.
create policy "avatars: read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
