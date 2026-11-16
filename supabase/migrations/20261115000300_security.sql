-- TeamFlow 0003: who can see and change what.
-- Three layers: column-level grants, row level security, and (in 0004) trusted functions.
-- The frontend is never trusted; every rule here holds for direct API requests too.

-- ------------------------------------------------------------------ helpers used by policies
-- SECURITY DEFINER so a policy can look at another table without recursing into
-- that table's own policies. They live in the private schema, which the API does not expose.

create function private.is_project_owner(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = p_project_id and owner_id = (select auth.uid()))
$$;

create function private.is_project_member(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members where project_id = p_project_id and user_id = (select auth.uid()))
$$;

create function private.is_active_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = p_project_id and status = 'active')
$$;

create function private.owns_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t join public.projects p on p.id = t.project_id
    where t.id = p_task_id and p.owner_id = (select auth.uid())
  )
$$;

create function private.is_task_project_member(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t join public.project_members m on m.project_id = t.project_id
    where t.id = p_task_id and m.user_id = (select auth.uid())
  )
$$;

-- A task is open to the project owner and to the member it is assigned to. Nobody else.
create function private.can_access_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t join public.projects p on p.id = t.project_id
    where t.id = p_task_id
      and (p.owner_id = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
$$;

-- Owners see their members, members see their owners. Members do not see each other.
create function private.shares_project_with(p_profile_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p join public.project_members m on m.project_id = p.id
    where (p.owner_id = (select auth.uid()) and m.user_id = p_profile_id)
       or (p.owner_id = p_profile_id and m.user_id = (select auth.uid()))
  )
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ------------------------------------------------------------------ grants
-- Start from nothing, then grant the narrowest set. Anonymous visitors get no table access.
-- Columns that must never be client-writable (status, owner, role, versions) are simply not granted.

revoke all on table
  public.projects, public.project_members, public.invitations, public.tasks,
  public.submissions, public.comments, public.activity_logs
from anon, authenticated;

grant select on table public.projects to authenticated;
grant insert (name, description) on table public.projects to authenticated;
grant update (name, description, status) on table public.projects to authenticated;
grant delete on table public.projects to authenticated;

grant select on table public.project_members to authenticated;

-- token_hash is not readable through the API, even by the owner.
grant select (id, project_id, email, status, expires_at, created_at, invited_by) on table public.invitations to authenticated;

grant select on table public.tasks to authenticated;
grant insert (project_id, title, description, requirements, assigned_to, priority, deadline, programming_language, submission_type)
  on table public.tasks to authenticated;
grant update (title, description, requirements, assigned_to, priority, deadline, programming_language, submission_type)
  on table public.tasks to authenticated;
grant delete on table public.tasks to authenticated;

grant select on table public.submissions to authenticated;

grant select on table public.comments to authenticated;
grant insert (task_id, content) on table public.comments to authenticated;

grant select on table public.activity_logs to authenticated;

-- ------------------------------------------------------------------ row level security

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.invitations enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.comments enable row level security;
alter table public.activity_logs enable row level security;

-- profiles (the "read own" and "update own" policies are in 0001)
create policy "profiles: read teammates" on public.profiles
  for select to authenticated
  using (private.shares_project_with(id));

-- projects
create policy "projects: owner and members read" on public.projects
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_project_member(id));

create policy "projects: administrators create their own" on public.projects
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_admin()));

create policy "projects: owner updates" on public.projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "projects: owner deletes" on public.projects
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- project_members: read only. Rows are added by accept_invitation and removed by remove_member.
create policy "members: own row or project owner reads" on public.project_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_project_owner(project_id));

-- invitations: read only for the owner. Created, revoked and accepted through functions.
create policy "invitations: project owner reads" on public.invitations
  for select to authenticated
  using (private.is_project_owner(project_id));

-- tasks
create policy "tasks: owner reads all, members read their own" on public.tasks
  for select to authenticated
  using (private.is_project_owner(project_id) or assigned_to = (select auth.uid()));

create policy "tasks: owner creates in active projects" on public.tasks
  for insert to authenticated
  with check (private.is_project_owner(project_id) and private.is_active_project(project_id));

create policy "tasks: owner updates" on public.tasks
  for update to authenticated
  using (private.is_project_owner(project_id))
  with check (private.is_project_owner(project_id));

create policy "tasks: owner deletes" on public.tasks
  for delete to authenticated
  using (private.is_project_owner(project_id));

-- submissions: read only. Written by submit_solution and review_submission.
create policy "submissions: author or project owner reads" on public.submissions
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and private.is_task_project_member(task_id))
    or private.owns_task(task_id)
  );

-- comments: append only.
create policy "comments: task participants read" on public.comments
  for select to authenticated
  using (private.can_access_task(task_id));

create policy "comments: task participants write as themselves" on public.comments
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_access_task(task_id));

-- activity_logs: read only. Written by triggers and trusted functions.
create policy "activity: owner reads all, members read their own" on public.activity_logs
  for select to authenticated
  using (
    private.is_project_owner(project_id)
    or (user_id = (select auth.uid()) and private.is_project_member(project_id))
  );
