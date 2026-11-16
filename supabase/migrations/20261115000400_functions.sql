-- TeamFlow 0004: the trusted actions.
-- Each function reads the caller from the session (never from an argument),
-- checks permission, validates input and changes every affected table in one
-- transaction. They are the only way to move a task's status, write a
-- submission, or change who belongs to a project.

-- ------------------------------------------------------------------ invitations

-- Creates an invitation and returns the secret token ONCE. Only its SHA-256 hash is stored.
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
  if v_uid is null or v_project.id is null or v_project.owner_id <> v_uid then
    raise exception using errcode = '42501', message = 'Only the project owner can invite people.';
  end if;
  if v_project.status <> 'active' then
    raise exception 'This project is archived. Restore it before inviting people.';
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

  -- Retire invitations that ran out of time, then refuse a second live one.
  update public.invitations set status = 'expired'
  where project_id = p_project_id and email = v_email and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.invitations where project_id = p_project_id and email = v_email and status = 'pending') then
    raise exception 'There is already a pending invitation for that email. Revoke it to create a new one.';
  end if;

  -- 244 random bits from the database's cryptographic generator.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (project_id, email, token_hash, expires_at, invited_by)
  values (p_project_id, v_email, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expires, v_uid)
  returning id into v_id;

  perform private.log_activity(p_project_id, 'invitation.created', 'invitation', v_id, jsonb_build_object('email', v_email));
  return jsonb_build_object('invitation_id', v_id, 'token', v_token, 'email', v_email, 'expires_at', v_expires);
end $$;

create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id for update;
  if v_uid is null or v_invitation.id is null or not private.is_project_owner(v_invitation.project_id) then
    raise exception using errcode = '42501', message = 'Only the project owner can revoke invitations.';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'This invitation is no longer pending.';
  end if;
  update public.invitations set status = 'revoked' where id = p_invitation_id;
  perform private.log_activity(v_invitation.project_id, 'invitation.revoked', 'invitation', p_invitation_id, jsonb_build_object('email', v_invitation.email));
end $$;

-- What the invitation page shows before sign-in. The token is the only key, so a
-- wrong token reveals nothing.
create function public.get_invitation(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'project_name', p.name,
    'email', i.email,
    'invited_by_name', pr.full_name,
    'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    'expires_at', i.expires_at
  )
  from public.invitations i
  join public.projects p on p.id = i.project_id
  join public.profiles pr on pr.id = i.invited_by
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- Takes only the token. The project comes from the invitation and the user
-- from the session, so the browser cannot choose either.
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

-- Removing a member clears their task assignments (see the foreign key in 0002)
-- and keeps every submission they made.
create function public.remove_member(p_project_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null or not private.is_project_owner(p_project_id) then
    raise exception using errcode = '42501', message = 'Only the project owner can remove members.';
  end if;
  if p_user_id = v_uid then
    raise exception 'The project owner cannot be removed.';
  end if;
  select full_name into v_name from public.profiles where id = p_user_id;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
  if not found then
    raise exception 'That person is not in this project.';
  end if;
  perform private.log_activity(p_project_id, 'member.removed', 'member', p_user_id, jsonb_build_object('name', v_name));
end $$;

-- ------------------------------------------------------------------ tasks and submissions

create function public.start_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_uid is null or v_task.id is null or v_task.assigned_to is distinct from v_uid then
    raise exception using errcode = '42501', message = 'This task is not assigned to you.';
  end if;
  if v_task.status = 'todo' then
    update public.tasks set status = 'in_progress' where id = p_task_id;
    perform private.log_activity(v_task.project_id, 'task.started', 'task', p_task_id, jsonb_build_object('title', v_task.title));
  end if;
end $$;

-- Stores a new version. Earlier versions are never touched.
-- For file uploads the browser uploads to Storage first, then passes the path here.
create function public.submit_solution(
  p_task_id uuid,
  p_content text,
  p_language text default null,
  p_file_path text default null,
  p_file_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_project_status text;
  v_content text := p_content;
  v_language text;
  v_file_path text;
  v_file_name text;
  v_version integer;
  v_id uuid;
begin
  -- Locking the task row makes two simultaneous submissions queue up, so
  -- version numbers can never collide.
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_uid is null or v_task.id is null or v_task.assigned_to is distinct from v_uid then
    raise exception using errcode = '42501', message = 'This task is not assigned to you.';
  end if;

  select status into v_project_status from public.projects where id = v_task.project_id;
  if v_project_status <> 'active' then
    raise exception 'This project is archived, so it is not accepting submissions.';
  end if;
  if v_task.status = 'completed' then
    raise exception 'This task is already completed.';
  elsif v_task.status = 'submitted' then
    raise exception 'Your last submission is still waiting for review.';
  end if;

  if v_task.submission_type = 'file_upload' then
    v_content := null;
    v_file_path := p_file_path;
    v_file_name := left(btrim(coalesce(p_file_name, '')), 255);
    if v_file_path is null or v_file_name = ''
       or v_file_path not like p_task_id::text || '/' || v_uid::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'submissions' and o.name = v_file_path) then
      raise exception 'Upload your file first, then submit it.';
    end if;
  else
    if v_content is null or btrim(v_content) = '' then
      raise exception 'Your submission is empty.';
    end if;
    if v_task.submission_type = 'code' then
      if char_length(v_content) > 200000 then
        raise exception 'That is too long. Keep code submissions under 200,000 characters.';
      end if;
      v_language := lower(btrim(coalesce(p_language, v_task.programming_language, '')));
      if v_language not in ('html', 'css', 'javascript', 'typescript', 'python', 'cpp', 'java', 'sql') then
        raise exception 'Choose a supported programming language.';
      end if;
    elsif v_task.submission_type = 'text' then
      if char_length(v_content) > 50000 then
        raise exception 'That is too long. Keep text submissions under 50,000 characters.';
      end if;
    else
      v_content := btrim(v_content);
      if char_length(v_content) > 300
         or v_content !~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[^\s]*)?$' then
        raise exception 'Paste a link to a GitHub repository, like https://github.com/name/project.';
      end if;
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.submissions where task_id = p_task_id;

  insert into public.submissions (task_id, user_id, code, language, file_path, file_name, version)
  values (p_task_id, v_uid, v_content, v_language, v_file_path, v_file_name, v_version)
  returning id into v_id;

  update public.tasks set status = 'submitted' where id = p_task_id;
  perform private.log_activity(
    v_task.project_id, 'submission.submitted', 'submission', v_id,
    jsonb_build_object('title', v_task.title, 'version', v_version)
  );
  return jsonb_build_object('id', v_id, 'version', v_version);
end $$;

-- Approve or request a revision. The submission and its task change together or not at all.
-- This is the only code path that can set a task to Completed.
create function public.review_submission(p_submission_id uuid, p_decision text, p_feedback text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_task public.tasks;
  v_submission public.submissions;
  v_feedback text := nullif(btrim(coalesce(p_feedback, '')), '');
  v_approved boolean := (p_decision = 'approve');
begin
  select task_id into v_task_id from public.submissions where id = p_submission_id;
  select * into v_task from public.tasks where id = v_task_id for update;
  select * into v_submission from public.submissions where id = p_submission_id for update;

  if v_uid is null or v_submission.id is null or not private.is_project_owner(v_task.project_id) then
    raise exception using errcode = '42501', message = 'Only the project owner can review submissions.';
  end if;
  if v_submission.review_status <> 'pending' then
    raise exception 'This submission has already been reviewed.';
  end if;
  if p_decision is null or p_decision not in ('approve', 'request_revision') then
    raise exception 'The decision must be approve or request_revision.';
  end if;
  if not v_approved and v_feedback is null then
    raise exception 'Write some feedback so they know what to change.';
  end if;
  if char_length(coalesce(v_feedback, '')) > 5000 then
    raise exception 'Keep feedback under 5,000 characters.';
  end if;

  update public.submissions
  set review_status = case when v_approved then 'approved' else 'revision_requested' end,
      feedback = v_feedback,
      reviewed_by = v_uid,
      reviewed_at = now()
  where id = p_submission_id;

  update public.tasks
  set status = case when v_approved then 'completed' else 'revision_required' end
  where id = v_task.id;

  perform private.log_activity(
    v_task.project_id,
    case when v_approved then 'submission.approved' else 'submission.revision_requested' end,
    'submission', p_submission_id,
    jsonb_build_object('title', v_task.title, 'version', v_submission.version)
  );
end $$;

-- ------------------------------------------------------------------ dashboard

-- Runs with the caller's own permissions, so the counts cover exactly the rows
-- that person may see: an owner's whole projects, a member's own tasks.
create function public.dashboard_stats() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total_projects', (select count(*) from public.projects),
    'active_projects', (select count(*) from public.projects where status = 'active'),
    'total_tasks', (select count(*) from public.tasks),
    'completed_tasks', (select count(*) from public.tasks where status = 'completed'),
    'pending_tasks', (select count(*) from public.tasks where status <> 'completed'),
    'revision_tasks', (select count(*) from public.tasks where status = 'revision_required'),
    -- Reviews waiting for this person: pending work by someone else that they can see.
    'pending_reviews', (select count(*) from public.submissions
                        where review_status = 'pending' and user_id <> (select auth.uid()))
  )
$$;

-- ------------------------------------------------------------------ who may call what
-- Functions are executable by everyone by default, so close them first.

revoke execute on function
  public.create_invitation(uuid, text),
  public.revoke_invitation(uuid),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.remove_member(uuid, uuid),
  public.start_task(uuid),
  public.submit_solution(uuid, text, text, text, text),
  public.review_submission(uuid, text, text),
  public.dashboard_stats()
from public, anon, authenticated;

grant execute on function
  public.create_invitation(uuid, text),
  public.revoke_invitation(uuid),
  public.accept_invitation(text),
  public.remove_member(uuid, uuid),
  public.start_task(uuid),
  public.submit_solution(uuid, text, text, text, text),
  public.review_submission(uuid, text, text),
  public.dashboard_stats()
to authenticated;

-- The invitation page loads before sign-in, so the preview is open to visitors too.
grant execute on function public.get_invitation(text) to anon, authenticated;
