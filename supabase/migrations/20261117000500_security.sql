-- TeamFlow v2, 0500: who can see and change what.
-- Layer 1: grants, so columns such as roles, status, versions and scores are never
-- client-writable. Layer 2: row level security on every table. Layer 3 (0600):
-- trusted functions for every action that checks a rule or changes several rows.

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ------------------------------------------------------------------ grants

revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

grant select, delete on public.projects to authenticated;
grant insert (name, description, timezone) on public.projects to authenticated;
grant update (name, description, timezone, status) on public.projects to authenticated;

grant select on public.project_members to authenticated;

-- token_hash is never readable through the API.
grant select (id, project_id, email, status, invited_by, expires_at, created_at) on public.invitations to authenticated;

grant select on public.activity_logs to authenticated;

grant select, delete on public.tasks to authenticated;
grant insert (project_id, title, description, requirements, assigned_to, priority, deadline, submission_type, programming_language)
  on public.tasks to authenticated;
grant update (title, description, requirements, assigned_to, priority, deadline, submission_type, programming_language)
  on public.tasks to authenticated;

grant select on public.task_dependencies to authenticated;

grant select, delete on public.task_resources to authenticated;
grant insert (task_id, title, description, resource_type, external_url, storage_path, file_name) on public.task_resources to authenticated;
grant update (title, description, external_url) on public.task_resources to authenticated;

grant select, delete on public.task_comments to authenticated;
grant insert (task_id, parent_comment_id, kind, content) on public.task_comments to authenticated;
grant update (content) on public.task_comments to authenticated;

grant select on public.submissions, public.submission_reviews, public.submission_internal_notes to authenticated;

-- ------------------------------------------------------------------ row level security

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.invitations enable row level security;
alter table public.activity_logs enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_resources enable row level security;
alter table public.task_comments enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_reviews enable row level security;
alter table public.submission_internal_notes enable row level security;

-- profiles: yourself, people who share a project with you, and Platform Admins
-- (everyone may see who the admins are). Admins see everyone.
create policy "profiles: read" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or platform_role = 'platform_admin'
    or private.is_platform_admin()
    or private.shares_project_with(id)
  );

create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- projects
create policy "projects: admins and members read" on public.projects for select to authenticated
  using (private.is_platform_admin() or private.is_project_member(id));

create policy "projects: admins create" on public.projects for insert to authenticated
  with check (private.is_platform_admin());

create policy "projects: managers update" on public.projects for update to authenticated
  using (private.can_manage_project(id)) with check (private.can_manage_project(id));

create policy "projects: admins delete" on public.projects for delete to authenticated
  using (private.is_platform_admin());

-- project_members: read-only; changed by accept_invitation, remove_member, set_project_role.
create policy "members: read within your projects" on public.project_members for select to authenticated
  using (private.is_platform_admin() or private.is_project_member(project_id));

-- invitations: read-only for managers.
create policy "invitations: managers read" on public.invitations for select to authenticated
  using (private.can_manage_project(project_id));

-- activity_logs: read-only.
create policy "activity: scoped read" on public.activity_logs for select to authenticated
  using (
    private.is_platform_admin()
    or (project_id is not null and private.can_manage_project(project_id))
    or user_id = (select auth.uid())
  );

-- tasks: managers manage active projects; members read only what is assigned to them.
create policy "tasks: managers and assignee read" on public.tasks for select to authenticated
  using (private.can_manage_project(project_id) or assigned_to = (select auth.uid()));

create policy "tasks: managers create" on public.tasks for insert to authenticated
  with check (private.can_manage_project(project_id) and private.is_active_project(project_id));

create policy "tasks: managers update" on public.tasks for update to authenticated
  using (private.can_manage_project(project_id))
  with check (private.can_manage_project(project_id) and private.is_active_project(project_id));

create policy "tasks: managers delete" on public.tasks for delete to authenticated
  using (private.can_manage_project(project_id) and private.is_active_project(project_id));

-- task_dependencies: read-only; changed by add_task_dependency and remove_task_dependency.
create policy "dependencies: read with the task" on public.task_dependencies for select to authenticated
  using (private.can_access_task(task_id));

-- task_resources
create policy "resources: read with the task" on public.task_resources for select to authenticated
  using (private.can_access_task(task_id));

create policy "resources: managers add" on public.task_resources for insert to authenticated
  with check (private.can_manage_task(task_id) and private.task_is_active(task_id));

create policy "resources: managers edit" on public.task_resources for update to authenticated
  using (private.can_manage_task(task_id))
  with check (private.can_manage_task(task_id) and private.task_is_active(task_id));

create policy "resources: managers delete" on public.task_resources for delete to authenticated
  using (private.can_manage_task(task_id) and private.task_is_active(task_id));

-- task_comments: post as yourself, edit your own, delete your own (managers delete any).
create policy "comments: read with the task" on public.task_comments for select to authenticated
  using (private.can_access_task(task_id));

create policy "comments: post as yourself" on public.task_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_access_task(task_id) and private.task_is_active(task_id));

create policy "comments: edit your own" on public.task_comments for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.task_is_active(task_id));

create policy "comments: delete your own, or any as a manager" on public.task_comments for delete to authenticated
  using ((user_id = (select auth.uid()) or private.can_manage_task(task_id)) and private.task_is_active(task_id));

-- submissions and reviews: read-only; written by submit_solution and review_submission.
create policy "submissions: author and managers read" on public.submissions for select to authenticated
  using (private.can_view_submission(id));

create policy "reviews: author and managers read" on public.submission_reviews for select to authenticated
  using (private.can_view_submission(submission_id));

-- Internal notes: managers who did not write the work. Never members.
create policy "internal notes: reviewers read" on public.submission_internal_notes for select to authenticated
  using (private.can_review(submission_id));
