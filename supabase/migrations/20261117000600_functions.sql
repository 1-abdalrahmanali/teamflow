-- TeamFlow v2, 0600: the trusted actions.
-- Each function reads the caller from the session (never from an argument), checks
-- the caller's current permissions, validates input and changes every affected row
-- in one transaction.

-- ------------------------------------------------------------------ roles

create function public.set_platform_role(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_target public.profiles;
begin
  if v_uid is null or not private.is_platform_admin() then
    raise exception using errcode = '42501', message = 'Only a Platform Admin can change platform roles.';
  end if;
  if p_role is null or p_role not in ('user', 'platform_admin') then
    raise exception 'The role must be user or platform_admin.';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot change your own role. Ask another Platform Admin.';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if v_target.id is null then
    raise exception 'That person does not have an account.';
  end if;
  if v_target.platform_role = p_role then
    return;
  end if;
  update public.profiles set platform_role = p_role where id = p_user_id;
  perform private.log_activity(null, 'role.platform_changed', 'profile', p_user_id,
    jsonb_build_object('name', v_target.full_name, 'from', v_target.platform_role, 'to', p_role));
end $$;

create function public.set_project_role(p_project_id uuid, p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_current text;
  v_name text;
begin
  if v_uid is null or not private.is_platform_admin() then
    raise exception using errcode = '42501', message = 'Only a Platform Admin can make or remove Team Leaders.';
  end if;
  if p_role is null or p_role not in ('member', 'team_leader') then
    raise exception 'The project role must be member or team_leader.';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot change your own role. Ask another Platform Admin.';
  end if;
  select role into v_current from public.project_members where project_id = p_project_id and user_id = p_user_id for update;
  if v_current is null then
    raise exception 'That person is not a member of this project. Invite them first.';
  end if;
  if v_current = p_role then
    return;
  end if;
  update public.project_members set role = p_role where project_id = p_project_id and user_id = p_user_id;
  select full_name into v_name from public.profiles where id = p_user_id;
  perform private.log_activity(p_project_id, 'role.project_changed', 'member', p_user_id,
    jsonb_build_object('name', v_name, 'from', v_current, 'to', p_role));
end $$;

-- ------------------------------------------------------------------ invitations

-- Creates an invitation and returns the secret token once. Only its SHA-256 hash is stored.
create function public.create_invitation(p_project_id uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_project public.projects;
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_uid is null or v_project.id is null or not private.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'Only people who manage this project can invite.';
  end if;
  if v_project.status <> 'active' then
    raise exception 'This project is archived. A Platform Admin must restore it before anyone is invited.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email address.';
  end if;
  if exists (
    select 1 from public.project_members m join public.profiles pr on pr.id = m.user_id
    where m.project_id = p_project_id and pr.email = v_email
  ) then
    raise exception 'That person is already in this project.';
  end if;

  update public.invitations set status = 'expired'
  where project_id = p_project_id and email = v_email and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.invitations where project_id = p_project_id and email = v_email and status = 'pending') then
    raise exception 'There is already a pending invitation for that email. Send it again or revoke it.';
  end if;

  -- 244 random bits from the database's cryptographic generator.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (project_id, email, token_hash, expires_at, invited_by)
  values (p_project_id, v_email, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires, v_uid)
  returning id into v_id;

  perform private.log_activity(p_project_id, 'invitation.created', 'invitation', v_id, jsonb_build_object('email', v_email));
  return jsonb_build_object(
    'invitation_id', v_id, 'token', v_token, 'email', v_email, 'expires_at', v_expires,
    'project_name', v_project.name,
    'inviter_name', (select full_name from public.profiles where id = v_uid)
  );
end $$;

create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id for update;
  if auth.uid() is null or v_invitation.id is null or not private.can_manage_project(v_invitation.project_id) then
    raise exception using errcode = '42501', message = 'Only people who manage this project can revoke invitations.';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'This invitation is no longer pending.';
  end if;
  update public.invitations set status = 'revoked' where id = p_invitation_id;
  perform private.log_activity(v_invitation.project_id, 'invitation.revoked', 'invitation', p_invitation_id,
    jsonb_build_object('email', v_invitation.email));
end $$;

-- The raw token is never stored, so "send again" retires the old link and makes a new one.
create function public.resend_invitation(p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id for update;
  if auth.uid() is null or v_invitation.id is null or not private.can_manage_project(v_invitation.project_id) then
    raise exception using errcode = '42501', message = 'Only people who manage this project can invite.';
  end if;
  if v_invitation.status not in ('pending', 'expired') then
    raise exception 'Only pending or expired invitations can be sent again.';
  end if;
  if v_invitation.status = 'pending' then
    update public.invitations set status = 'revoked' where id = p_invitation_id;
  end if;
  return public.create_invitation(v_invitation.project_id, v_invitation.email);
end $$;

-- What the invitation page shows before sign-in. A wrong token reveals nothing.
create function public.get_invitation(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'project_name', p.name,
    'email', i.email,
    'invited_by_name', coalesce(pr.full_name, 'A project manager'),
    'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    'expires_at', i.expires_at
  )
  from public.invitations i
  join public.projects p on p.id = i.project_id
  left join public.profiles pr on pr.id = i.invited_by
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- Takes only the token: the project comes from the invitation and the person from the session.
create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_invitation public.invitations;
  v_email text;
  v_confirmed_at timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Sign in to accept this invitation.';
  end if;
  select * into v_invitation from public.invitations
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update;

  if v_invitation.id is null then
    raise exception 'This invitation link is not valid.';
  elsif v_invitation.status = 'accepted' then
    raise exception 'This invitation has already been used.';
  elsif v_invitation.status = 'revoked' then
    raise exception 'This invitation was withdrawn. Ask for a new one.';
  elsif v_invitation.status = 'expired' or v_invitation.expires_at <= now() then
    raise exception 'This invitation has expired. Ask for a new one.';
  end if;
  if not private.is_active_project(v_invitation.project_id) then
    raise exception 'This project is archived, so it is not taking new members.';
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmed_at from auth.users u where u.id = v_uid;
  if v_email is null or lower(v_email) <> v_invitation.email then
    raise exception using errcode = '42501', message = 'This invitation was sent to a different email address.';
  end if;
  if v_confirmed_at is null then
    raise exception using errcode = '42501', message = 'Confirm your email address first, then open the invitation link again.';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_invitation.project_id, v_uid, 'member')
  on conflict (project_id, user_id) do nothing;
  update public.invitations set status = 'accepted' where id = v_invitation.id;
  perform private.log_activity(v_invitation.project_id, 'member.joined', 'member', v_uid, '{}'::jsonb);
  return v_invitation.project_id;
end $$;

-- ------------------------------------------------------------------ membership

-- Removing someone clears their task assignments and keeps everything they submitted.
create function public.remove_member(p_project_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_name text;
begin
  if auth.uid() is null or not private.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'Only people who manage this project can remove members.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot remove yourself from a project. Ask a Platform Admin.';
  end if;
  if not private.is_active_project(p_project_id) then
    raise exception 'This project is archived. A Platform Admin must restore it first.';
  end if;
  select role into v_role from public.project_members where project_id = p_project_id and user_id = p_user_id;
  if v_role is null then
    raise exception 'That person is not in this project.';
  end if;
  if v_role = 'team_leader' and not private.is_platform_admin() then
    raise exception using errcode = '42501', message = 'Only a Platform Admin can remove a Team Leader.';
  end if;
  select full_name into v_name from public.profiles where id = p_user_id;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
  perform private.log_activity(p_project_id, 'member.removed', 'member', p_user_id, jsonb_build_object('name', v_name));
end $$;

-- ------------------------------------------------------------------ tasks and dependencies

create function public.start_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if auth.uid() is null or v_task.id is null or v_task.assigned_to is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'This task is not assigned to you.';
  end if;
  if not private.is_active_project(v_task.project_id) then
    raise exception 'This project is archived, so its tasks are read-only.';
  end if;
  if private.is_task_blocked(p_task_id) then
    raise exception 'This task is blocked until its prerequisites are completed.';
  end if;
  if v_task.status = 'todo' then
    update public.tasks set status = 'in_progress' where id = p_task_id;
    perform private.log_activity(v_task.project_id, 'task.started', 'task', p_task_id, jsonb_build_object('title', v_task.title));
  end if;
end $$;

create function public.add_task_dependency(p_task_id uuid, p_depends_on uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
  v_prereq public.tasks;
  v_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id;
  select * into v_prereq from public.tasks where id = p_depends_on;
  if v_task.id is null or v_prereq.id is null then
    raise exception 'That task does not exist.';
  end if;
  if auth.uid() is null or not private.can_manage_project(v_task.project_id) then
    raise exception using errcode = '42501', message = 'Only people who manage this project can change dependencies.';
  end if;
  if p_task_id = p_depends_on then
    raise exception 'A task cannot depend on itself.';
  end if;
  if v_task.project_id <> v_prereq.project_id then
    raise exception 'Both tasks must be in the same project.';
  end if;
  if not private.is_active_project(v_task.project_id) then
    raise exception 'This project is archived, so its tasks are read-only.';
  end if;

  -- One dependency change per project at a time, so two simultaneous links cannot form a loop.
  perform pg_advisory_xact_lock(hashtextextended(v_task.project_id::text, 0));

  if exists (select 1 from public.task_dependencies where task_id = p_task_id and depends_on_task_id = p_depends_on) then
    raise exception 'This task already depends on that one.';
  end if;
  if v_task.status <> 'todo' and v_prereq.status <> 'completed' then
    raise exception 'This task has already started, so it can only gain prerequisites that are already completed.';
  end if;
  -- Walk everything the prerequisite needs, directly or through others. Reaching this task means a loop.
  if exists (
    with recursive chain (id) as (
      select d.depends_on_task_id from public.task_dependencies d where d.task_id = p_depends_on
      union
      select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = p_task_id
  ) then
    raise exception 'That would create a loop: "%" already depends on this task, directly or through other tasks.', v_prereq.title;
  end if;

  insert into public.task_dependencies (task_id, depends_on_task_id) values (p_task_id, p_depends_on) returning id into v_id;
  perform private.log_activity(v_task.project_id, 'dependency.added', 'task', p_task_id,
    jsonb_build_object('title', v_task.title, 'depends_on', v_prereq.title));
  return v_id;
end $$;

create function public.remove_task_dependency(p_task_id uuid, p_depends_on uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if auth.uid() is null or v_task.id is null or not private.can_manage_project(v_task.project_id) then
    raise exception using errcode = '42501', message = 'Only people who manage this project can change dependencies.';
  end if;
  if not private.is_active_project(v_task.project_id) then
    raise exception 'This project is archived, so its tasks are read-only.';
  end if;
  delete from public.task_dependencies where task_id = p_task_id and depends_on_task_id = p_depends_on;
  perform private.log_activity(v_task.project_id, 'dependency.removed', 'task', p_task_id, jsonb_build_object('title', v_task.title));
end $$;

-- What a task waits for, including prerequisites the caller could not open themselves.
create function public.task_prerequisites(p_task_id uuid)
returns table (task_id uuid, title text, status text, assignee_name text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.can_access_task(p_task_id) then
    raise exception using errcode = '42501', message = 'This task is not available to you.';
  end if;
  return query
    select pre.id, pre.title, pre.status, pr.full_name
    from public.task_dependencies d
    join public.tasks pre on pre.id = d.depends_on_task_id
    left join public.profiles pr on pr.id = pre.assigned_to
    where d.task_id = p_task_id
    order by pre.title;
end $$;

-- Which of these tasks are blocked right now, limited to tasks the caller can open.
-- One call for a whole task list, instead of one per task.
create function public.blocked_tasks(p_task_ids uuid[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.tasks t
  where t.id = any (coalesce(p_task_ids, '{}')) and private.can_access_task(t.id) and private.is_task_blocked(t.id)
$$;

-- ------------------------------------------------------------------ discussion

create function public.set_comment_pinned(p_comment_id uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_task uuid;
begin
  select task_id into v_task from public.task_comments where id = p_comment_id;
  if auth.uid() is null or v_task is null or not private.can_manage_task(v_task) then
    raise exception using errcode = '42501', message = 'Only people who manage this project can pin posts.';
  end if;
  if not private.task_is_active(v_task) then
    raise exception 'This project is archived, so its discussions are read-only.';
  end if;
  update public.task_comments set is_pinned = coalesce(p_pinned, false) where id = p_comment_id;
end $$;

-- ------------------------------------------------------------------ submissions

-- Stores a new version; earlier versions are never touched. File tasks upload to
-- Storage first and pass the path, which must be the member's own upload for this task.
create function public.submit_solution(
  p_task_id uuid, p_code text, p_language text, p_text text, p_file_path text, p_file_name text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_language text;
  v_file_name text;
  v_version integer;
  v_id uuid;
begin
  -- Locking the task makes simultaneous submissions queue up, so versions never collide.
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_uid is null or v_task.id is null or v_task.assigned_to is distinct from v_uid then
    raise exception using errcode = '42501', message = 'This task is not assigned to you.';
  end if;
  if not private.is_active_project(v_task.project_id) then
    raise exception 'This project is archived, so it is not taking submissions.';
  end if;
  if v_task.status = 'completed' then
    raise exception 'This task is already completed.';
  elsif v_task.status = 'submitted' then
    raise exception 'Your last submission is still waiting for review.';
  end if;
  if private.is_task_blocked(p_task_id) then
    raise exception 'This task is blocked until its prerequisites are completed.';
  end if;

  if v_task.submission_type = 'code' then
    if p_code is null or btrim(p_code) = '' then
      raise exception 'This task takes code. Write your solution in the editor.';
    end if;
    if char_length(p_code) > 200000 then
      raise exception 'That is too long. Keep code under 200,000 characters.';
    end if;
    v_language := lower(btrim(coalesce(p_language, v_task.programming_language, '')));
    if v_language not in ('html', 'css', 'javascript', 'typescript', 'python', 'cpp', 'java', 'sql') then
      raise exception 'Choose a supported programming language.';
    end if;
  elsif v_task.submission_type = 'text' then
    if p_text is null or btrim(p_text) = '' then
      raise exception 'This task takes a written answer. Write it before submitting.';
    end if;
    if char_length(p_text) > 50000 then
      raise exception 'That is too long. Keep written answers under 50,000 characters.';
    end if;
  else
    v_file_name := left(btrim(coalesce(p_file_name, '')), 255);
    if p_file_path is null or v_file_name = ''
       or p_file_path not like p_task_id::text || '/' || v_uid::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'submissions' and o.name = p_file_path) then
      raise exception 'Upload your file first, then submit it.';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.submissions where task_id = p_task_id;
  insert into public.submissions (task_id, user_id, version, submission_type, code_content, language, text_content, storage_path, file_name)
  values (
    p_task_id, v_uid, v_version, v_task.submission_type,
    case when v_task.submission_type = 'code' then p_code end,
    v_language,
    case when v_task.submission_type = 'text' then p_text end,
    case when v_task.submission_type = 'file' then p_file_path end,
    v_file_name
  )
  returning id into v_id;

  update public.tasks set status = 'submitted' where id = p_task_id;
  perform private.log_activity(v_task.project_id, 'submission.submitted', 'submission', v_id,
    jsonb_build_object('title', v_task.title, 'version', v_version));
  return jsonb_build_object('id', v_id, 'version', v_version);
end $$;

-- ------------------------------------------------------------------ review

-- Approve (with a score) or ask for changes (with feedback). The review, the version and
-- the task change together or not at all. The only code path that completes a task.
create function public.review_submission(
  p_submission_id uuid, p_decision text, p_feedback text, p_score integer, p_internal_note text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_task public.tasks;
  v_submission public.submissions;
  v_feedback text := nullif(btrim(coalesce(p_feedback, '')), '');
  v_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  v_approved boolean := (p_decision = 'approve');
begin
  select task_id into v_task_id from public.submissions where id = p_submission_id;
  select * into v_task from public.tasks where id = v_task_id for update;
  select * into v_submission from public.submissions where id = p_submission_id for update;

  if v_uid is null or v_submission.id is null or not private.can_manage_project(v_task.project_id) then
    raise exception using errcode = '42501', message = 'You cannot review this submission.';
  end if;
  if v_submission.user_id = v_uid then
    raise exception using errcode = '42501', message = 'You cannot review your own work. Another manager has to.';
  end if;
  if v_submission.review_status <> 'pending' then
    raise exception 'This version has already been reviewed.';
  end if;
  if not private.is_active_project(v_task.project_id) then
    raise exception 'This project is archived, so its reviews are read-only.';
  end if;
  if p_decision is null or p_decision not in ('approve', 'request_revision') then
    raise exception 'The decision must be approve or request_revision.';
  end if;
  if v_approved then
    if p_score is null or p_score < 0 or p_score > 100 then
      raise exception 'Give a score from 0 to 100 to approve.';
    end if;
  else
    if v_feedback is null then
      raise exception 'Write some feedback so they know what to change.';
    end if;
    if p_score is not null then
      raise exception 'A change request takes no score. Score the version you approve.';
    end if;
  end if;
  if char_length(coalesce(v_feedback, '')) > 5000 or char_length(coalesce(v_note, '')) > 5000 then
    raise exception 'Keep feedback and notes under 5,000 characters.';
  end if;

  insert into public.submission_reviews (submission_id, reviewer_id, review_action, feedback, score)
  values (p_submission_id, v_uid, case when v_approved then 'approved' else 'revision_requested' end, v_feedback,
          case when v_approved then p_score end);
  update public.submissions set review_status = case when v_approved then 'approved' else 'revision_requested' end
  where id = p_submission_id;
  update public.tasks set status = case when v_approved then 'completed' else 'revision_required' end
  where id = v_task.id;
  if v_note is not null then
    insert into public.submission_internal_notes (submission_id, reviewer_id, content) values (p_submission_id, v_uid, v_note);
  end if;

  perform private.log_activity(v_task.project_id,
    case when v_approved then 'submission.approved' else 'submission.revision_requested' end,
    'submission', p_submission_id,
    jsonb_build_object('title', v_task.title, 'version', v_submission.version, 'score', case when v_approved then p_score end));
end $$;

create function public.add_internal_note(p_submission_id uuid, p_content text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_id uuid;
begin
  if auth.uid() is null or not private.can_review(p_submission_id) then
    raise exception using errcode = '42501', message = 'You cannot review this submission, so you cannot add notes to it.';
  end if;
  if v_content is null or char_length(v_content) > 5000 then
    raise exception 'Write a note of up to 5,000 characters.';
  end if;
  insert into public.submission_internal_notes (submission_id, reviewer_id, content)
  values (p_submission_id, auth.uid(), v_content) returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------ numbers

-- The three numbers on the personal dashboard. Completed and Average come from approved
-- versions, so they survive reassignment and removal, and extra versions never count twice.
create function public.member_performance(p_user_id uuid, p_project_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_all boolean := false;
  v_projects uuid[];
  v_assigned integer;
  v_completed integer;
  v_average numeric;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Sign in to see performance numbers.';
  end if;
  if v_uid = p_user_id or private.is_platform_admin() then
    v_all := p_project_id is null;
    v_projects := case when p_project_id is null then null else array[p_project_id] end;
  elsif p_project_id is not null then
    if coalesce(private.project_role(p_project_id), '') <> 'team_leader' then
      raise exception using errcode = '42501', message = 'You cannot see this person''s numbers.';
    end if;
    v_projects := array[p_project_id];
  else
    v_projects := array(
      select mine.project_id from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id and theirs.user_id = p_user_id
      where mine.user_id = v_uid and mine.role = 'team_leader'
    );
    if cardinality(v_projects) = 0 then
      raise exception using errcode = '42501', message = 'You cannot see this person''s numbers.';
    end if;
  end if;

  select count(*) into v_assigned from public.tasks t
  where t.assigned_to = p_user_id and (v_all or t.project_id = any (v_projects));

  select count(distinct s.task_id), avg(r.score) into v_completed, v_average
  from public.submissions s
  join public.submission_reviews r on r.submission_id = s.id and r.review_action = 'approved'
  join public.tasks t on t.id = s.task_id
  where s.user_id = p_user_id and (v_all or t.project_id = any (v_projects));

  return jsonb_build_object(
    'assigned_tasks', v_assigned,
    'completed_tasks', v_completed,
    'average_score', case when v_average is null then null else round(v_average, 1) end
  );
end $$;

-- Counts over exactly what the caller may see (it runs with their permissions).
create function public.overview_stats() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total_projects', (select count(*) from public.projects),
    'active_projects', (select count(*) from public.projects where status = 'active'),
    'total_tasks', (select count(*) from public.tasks),
    'completed_tasks', (select count(*) from public.tasks where status = 'completed'),
    'open_tasks', (select count(*) from public.tasks where status <> 'completed'),
    'overdue_tasks', (select count(*) from public.tasks where status <> 'completed' and deadline < now()),
    'pending_reviews', (select count(*) from public.submissions where review_status = 'pending' and user_id <> (select auth.uid())),
    'total_users', (select count(*) from public.profiles)
  )
$$;

-- ------------------------------------------------------------------ who may call what

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.set_platform_role(uuid, text),
  public.set_project_role(uuid, uuid, text),
  public.create_invitation(uuid, text),
  public.revoke_invitation(uuid),
  public.resend_invitation(uuid),
  public.accept_invitation(text),
  public.remove_member(uuid, uuid),
  public.start_task(uuid),
  public.add_task_dependency(uuid, uuid),
  public.remove_task_dependency(uuid, uuid),
  public.task_prerequisites(uuid),
  public.blocked_tasks(uuid[]),
  public.set_comment_pinned(uuid, boolean),
  public.submit_solution(uuid, text, text, text, text, text),
  public.review_submission(uuid, text, text, integer, text),
  public.add_internal_note(uuid, text),
  public.member_performance(uuid, uuid),
  public.overview_stats()
to authenticated;

-- The invitation page loads before sign-in, so the preview is open to visitors too.
grant execute on function public.get_invitation(text) to anon, authenticated;
