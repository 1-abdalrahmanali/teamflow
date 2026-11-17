-- TeamFlow v2, 0300: tasks, dependencies, learning resources, discussion.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  requirements text not null default '' check (char_length(requirements) <= 10000),
  assigned_to uuid,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'submitted', 'revision_required', 'completed')),
  deadline timestamptz,
  submission_type text not null default 'code' check (submission_type in ('code', 'text', 'file')),
  programming_language text
    check (programming_language is null
           or programming_language in ('html', 'css', 'javascript', 'typescript', 'python', 'cpp', 'java', 'sql')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The assignee must be a member of the same project. Removing the member clears
  -- the assignment instead of blocking the removal.
  constraint tasks_assignee_is_project_member
    foreign key (project_id, assigned_to) references public.project_members (project_id, user_id)
    on delete set null (assigned_to),
  constraint tasks_assigned_to_fkey foreign key (assigned_to) references public.profiles (id) on delete set null
);
create index tasks_project_idx on public.tasks (project_id, status);
create index tasks_assigned_idx on public.tasks (assigned_to);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_dependencies_unique unique (task_id, depends_on_task_id),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id)
);
create index task_dependencies_prereq_idx on public.task_dependencies (depends_on_task_id);

create table public.task_resources (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  resource_type text not null check (resource_type in
    ('youtube', 'documentation', 'article', 'reference_project', 'pdf', 'image', 'starter_code', 'document')),
  external_url text check (external_url is null or char_length(external_url) <= 2000),
  storage_path text,
  file_name text check (file_name is null or char_length(file_name) between 1 and 255),
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A link type carries an https link and no file; a file type carries a file and no link.
  constraint task_resources_content check (
    (resource_type in ('youtube', 'documentation', 'article', 'reference_project')
      and external_url ~ '^https://[^\s/$.?#][^\s]*$' and storage_path is null and file_name is null)
    or
    (resource_type in ('pdf', 'image', 'starter_code', 'document')
      and storage_path is not null and file_name is not null and external_url is null)
  ),
  constraint task_resources_youtube_link check (
    resource_type <> 'youtube'
    or external_url ~ '^https://(www\.|m\.)?(youtube\.com/(watch\?v=|embed/|shorts/)|youtu\.be/)[A-Za-z0-9_-]{6,}'
  )
);
create index task_resources_task_idx on public.task_resources (task_id);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  parent_comment_id uuid references public.task_comments (id) on delete cascade,
  kind text,
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Top-level posts are a question or a comment; replies carry no kind.
  constraint task_comments_kind check (
    (parent_comment_id is null and kind in ('question', 'comment'))
    or (parent_comment_id is not null and kind is null)
  )
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- ------------------------------------------------------------------ task helpers

create function private.task_project(p_task_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select project_id from public.tasks where id = p_task_id
$$;

create function private.can_manage_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.can_manage_project(private.task_project(p_task_id)), false)
$$;

-- A task is open to its project's managers and to its assignee. Nobody else.
create function private.can_access_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and (t.assigned_to = (select auth.uid()) or private.can_manage_project(t.project_id))
  )
$$;

create function private.task_is_active(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_project(private.task_project(p_task_id))
$$;

-- Blocked = at least one prerequisite is not completed yet.
create function private.is_task_blocked(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.task_dependencies d
    join public.tasks pre on pre.id = d.depends_on_task_id
    where d.task_id = p_task_id and pre.status <> 'completed'
  )
$$;

-- ------------------------------------------------------------------ task triggers

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- Reassignment rules. Status is never written by clients; this trigger and the
-- trusted functions are the only things that move it.
create function private.guard_task_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.submission_type is distinct from old.submission_type
     and exists (select 1 from public.submissions where task_id = old.id) then
    raise exception 'This task already has submissions, so how it is handed in can no longer change.';
  end if;

  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  if new.assigned_to is null then
    -- The member was removed or the manager cleared it: open work goes back to To do.
    if old.status in ('in_progress', 'revision_required') then
      new.status := 'todo';
    end if;
  elsif old.status = 'completed' then
    raise exception 'Completed tasks cannot be reassigned.';
  elsif old.status = 'submitted' then
    raise exception 'This task has a submission waiting for review. Review it before reassigning.';
  else
    new.status := 'todo';
  end if;
  return new;
end $$;

create trigger tasks_guard_update before update on public.tasks
  for each row execute function private.guard_task_update();

create function private.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.project_id, 'task.created', 'task', new.id, jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    if new.assigned_to is distinct from old.assigned_to then
      perform private.log_activity(new.project_id,
        case when new.assigned_to is null then 'task.unassigned' else 'task.assigned' end,
        'task', new.id, jsonb_build_object('title', new.title));
    end if;
  else
    -- Skip while the whole project is being deleted: there is nothing left to attach the entry to.
    if exists (select 1 from public.projects where id = old.project_id) then
      perform private.log_activity(old.project_id, 'task.deleted', 'task', old.id, jsonb_build_object('title', old.title));
    end if;
    return old;
  end if;
  return new;
end $$;

create trigger tasks_log_change after insert or update or delete on public.tasks
  for each row execute function private.log_task_change();

-- A file resource must point at a file really uploaded into this task's folder,
-- with an extension that suits its type.
create function private.validate_resource() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid := private.task_project(new.task_id);
  v_ext text;
  v_allowed text[];
begin
  if new.storage_path is null then
    return new;
  end if;
  if new.storage_path not like v_project::text || '/' || new.task_id::text || '/%' then
    raise exception 'That file is not in this task''s folder.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'task-resources' and o.name = new.storage_path) then
    raise exception 'Upload the file first, then add it as a resource.';
  end if;
  v_ext := lower(substring(new.storage_path from '\.([A-Za-z0-9]+)$'));
  v_allowed := case new.resource_type
    when 'pdf' then array['pdf']
    when 'image' then array['png', 'jpg', 'jpeg', 'gif', 'webp']
    when 'starter_code' then array['zip', 'js', 'mjs', 'ts', 'py', 'html', 'css', 'java', 'cpp', 'c', 'h', 'hpp', 'sql', 'txt', 'md', 'json']
    else array['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'zip']
  end;
  if v_ext is null or not (v_ext = any (v_allowed)) then
    raise exception 'That file type does not fit a % resource. Allowed: %.', replace(new.resource_type, '_', ' '), array_to_string(v_allowed, ', ');
  end if;
  return new;
end $$;

-- Checked when the file or type is set, not on unrelated updates (such as the uploader's
-- account being deleted), so a later change elsewhere never trips over an old file.
create trigger task_resources_validate before insert or update of task_id, resource_type, storage_path, file_name on public.task_resources
  for each row execute function private.validate_resource();

create trigger task_resources_set_updated_at before update on public.task_resources
  for each row execute function private.set_updated_at();

-- Replies stay one level deep and on the same task.
create function private.validate_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.task_comments;
begin
  if new.parent_comment_id is not null then
    select * into v_parent from public.task_comments where id = new.parent_comment_id;
    if v_parent.id is null or v_parent.task_id <> new.task_id then
      raise exception 'A reply must be on the same task as the post it answers.';
    end if;
    if v_parent.parent_comment_id is not null then
      raise exception 'You cannot reply to a reply. Reply to the original post instead.';
    end if;
  end if;
  return new;
end $$;

create trigger task_comments_validate before insert on public.task_comments
  for each row execute function private.validate_comment();

-- Only a change to the words counts as an edit; pinning leaves updated_at alone.
create trigger task_comments_set_updated_at before update of content on public.task_comments
  for each row execute function private.set_updated_at();
