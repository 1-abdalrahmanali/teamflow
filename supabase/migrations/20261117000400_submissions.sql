-- TeamFlow v2, 0400: submissions (one row per version), reviews and internal notes.

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null check (version > 0),
  submission_type text not null check (submission_type in ('code', 'text', 'file')),
  code_content text,
  language text check (language is null
    or language in ('html', 'css', 'javascript', 'typescript', 'python', 'cpp', 'java', 'sql')),
  text_content text,
  storage_path text,
  file_name text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'revision_requested')),
  submitted_at timestamptz not null default now(),
  constraint submissions_task_version_key unique (task_id, version),
  -- Each version holds exactly the content its type needs.
  constraint submissions_content check (
    (submission_type = 'code' and code_content is not null and language is not null
      and text_content is null and storage_path is null and file_name is null)
    or (submission_type = 'text' and text_content is not null
      and code_content is null and language is null and storage_path is null and file_name is null)
    or (submission_type = 'file' and storage_path is not null and file_name is not null
      and code_content is null and language is null and text_content is null)
  )
);
create index submissions_user_idx on public.submissions (user_id);
create index submissions_pending_idx on public.submissions (submitted_at) where review_status = 'pending';

-- One decision per version.
create table public.submission_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  review_action text not null check (review_action in ('approved', 'revision_requested')),
  feedback text check (feedback is null or char_length(feedback) <= 5000),
  score integer check (score is null or score between 0 and 100),
  created_at timestamptz not null default now(),
  constraint submission_reviews_rules check (
    (review_action = 'approved' and score is not null)
    or (review_action = 'revision_requested' and score is null and feedback is not null and btrim(feedback) <> '')
  )
);

create table public.submission_internal_notes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  reviewer_id uuid default auth.uid() references public.profiles (id) on delete set null,
  content text not null check (char_length(btrim(content)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index submission_internal_notes_submission_idx on public.submission_internal_notes (submission_id);

-- ------------------------------------------------------------------ submission helpers

create function private.submission_task(p_submission_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select task_id from public.submissions where id = p_submission_id
$$;

-- The author, while still in the project, and the project's managers.
create function private.can_view_submission(p_submission_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission_id
      and ((s.user_id = (select auth.uid()) and private.is_project_member(private.task_project(s.task_id)))
           or private.can_manage_task(s.task_id))
  )
$$;

-- A reviewer manages the project and did not write the work.
create function private.can_review(p_submission_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission_id and s.user_id <> (select auth.uid()) and private.can_manage_task(s.task_id)
  )
$$;
