-- TeamFlow 0002: projects, membership, invitations, tasks, submissions, comments, activity.
-- Tables, constraints, indexes and the triggers that keep them consistent.
-- Access rules live in 0003; the actions that change several tables live in 0004.

-- ------------------------------------------------------------------ tables

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_id_idx on public.projects (owner_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_id_idx on public.project_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  invited_by uuid not null references public.profiles (id) on delete cascade
);
create index invitations_project_id_idx on public.invitations (project_id);
-- At most one live invitation per person per project.
create unique index invitations_one_pending_per_email
  on public.invitations (project_id, email) where status = 'pending';

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  requirements text not null default '' check (char_length(requirements) <= 10000),
  assigned_to uuid,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'submitted', 'revision_required', 'completed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  deadline timestamptz,
  programming_language text
    check (programming_language is null
           or programming_language in ('html', 'css', 'javascript', 'typescript', 'python', 'cpp', 'java', 'sql')),
  submission_type text not null default 'code'
    check (submission_type in ('code', 'text', 'github_link', 'file_upload')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The assignee must be a member of the same project. Removing the member
  -- clears the assignment instead of blocking the removal.
  constraint tasks_assignee_is_project_member
    foreign key (project_id, assigned_to)
    references public.project_members (project_id, user_id)
    on delete set null (assigned_to),
  -- A plain link to the profile as well, so the API can embed the assignee's name directly.
  constraint tasks_assigned_to_fkey
    foreign key (assigned_to) references public.profiles (id) on delete set null
);
create index tasks_project_id_idx on public.tasks (project_id, status);
create index tasks_assigned_to_idx on public.tasks (assigned_to);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null constraint submissions_user_id_fkey references public.profiles (id) on delete cascade,
  code text,           -- the submission body: code, text, or a GitHub link
  language text,
  file_path text,      -- set for file uploads: path inside the private "submissions" bucket
  file_name text,
  version integer not null check (version > 0),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'revision_requested')),
  feedback text,
  reviewed_by uuid constraint submissions_reviewed_by_fkey references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint submissions_task_version_key unique (task_id, version),
  constraint submissions_has_content check (code is not null or file_path is not null)
);
create index submissions_user_id_idx on public.submissions (user_id);
create index submissions_pending_idx on public.submissions (submitted_at) where review_status = 'pending';

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() constraint comments_user_id_fkey references public.profiles (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index comments_task_id_idx on public.comments (task_id, created_at);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid constraint activity_logs_user_id_fkey references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,   -- small readable snapshot, e.g. the task title
  created_at timestamptz not null default now()
);
create index activity_logs_project_idx on public.activity_logs (project_id, created_at desc);
create index activity_logs_user_idx on public.activity_logs (user_id);

-- ------------------------------------------------------------------ shared trigger helpers

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_set_updated_at before update on public.projects
  for each row execute function private.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- The only way rows reach activity_logs. Callers are triggers and trusted functions.
create function private.log_activity(
  p_project_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.activity_logs (project_id, user_id, action, entity_type, entity_id, metadata)
  values (p_project_id, (select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
$$;

-- ------------------------------------------------------------------ project triggers

-- The owner is always a member of their own project, with the admin role.
create function private.handle_new_project() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_members (project_id, user_id, role) values (new.id, new.owner_id, 'admin');
  perform private.log_activity(new.id, 'project.created', 'project', new.id, jsonb_build_object('name', new.name));
  return new;
end $$;

create trigger projects_after_insert after insert on public.projects
  for each row execute function private.handle_new_project();

create function private.handle_project_status_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_activity(
    new.id,
    case when new.status = 'archived' then 'project.archived' else 'project.restored' end,
    'project', new.id, jsonb_build_object('name', new.name)
  );
  return new;
end $$;

create trigger projects_after_status_change after update of status on public.projects
  for each row when (old.status is distinct from new.status)
  execute function private.handle_project_status_change();

-- ------------------------------------------------------------------ task triggers

-- Reassignment rules. Status is never written by clients; this trigger and the
-- functions in 0004 are the only things that move it.
create function private.guard_task_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  if new.assigned_to is null then
    -- Unassigned (the member was removed, or the owner cleared it): open work goes back to Todo.
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

create trigger tasks_guard_assignment before update of assigned_to on public.tasks
  for each row execute function private.guard_task_assignment();

create function private.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.project_id, 'task.created', 'task', new.id, jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
      perform private.log_activity(new.project_id, 'task.assigned', 'task', new.id, jsonb_build_object('title', new.title));
    end if;
  elsif tg_op = 'DELETE' then
    -- Skip when the whole project is being deleted: there is nothing left to attach the entry to.
    if exists (select 1 from public.projects where id = old.project_id) then
      perform private.log_activity(old.project_id, 'task.deleted', 'task', old.id, jsonb_build_object('title', old.title));
    end if;
    return old;
  end if;
  return new;
end $$;

create trigger tasks_log_change after insert or update or delete on public.tasks
  for each row execute function private.log_task_change();
