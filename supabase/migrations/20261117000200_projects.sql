-- TeamFlow v2, 0200: projects, membership with project roles, invitations, activity log.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_status_idx on public.projects (status);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'team_leader')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index invitations_project_idx on public.invitations (project_id);
create unique index invitations_one_pending_per_email on public.invitations (project_id, email) where status = 'pending';

-- project_id is empty for platform-wide events such as a Platform Admin promotion.
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_project_idx on public.activity_logs (project_id, created_at desc);
create index activity_logs_user_idx on public.activity_logs (user_id);

-- ------------------------------------------------------------------ helpers used by policies and functions
-- SECURITY DEFINER so a policy can look at another table without recursing into its policies.

create function private.project_role(p_project_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.project_members where project_id = p_project_id and user_id = (select auth.uid())
$$;

create function private.is_project_member(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members where project_id = p_project_id and user_id = (select auth.uid()))
$$;

-- "Manager" = a Platform Admin, or a Team Leader of this project.
create function private.can_manage_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or coalesce(private.project_role(p_project_id) = 'team_leader', false)
$$;

create function private.is_active_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = p_project_id and status = 'active')
$$;

create function private.shares_project_with(p_profile_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_profile_id
  )
$$;

-- The only way rows reach activity_logs.
create function private.log_activity(
  p_project_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.activity_logs (project_id, user_id, action, entity_type, entity_id, metadata)
  values (p_project_id, (select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
$$;

-- ------------------------------------------------------------------ project triggers

create function private.validate_project() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Choose a real time zone, such as Africa/Cairo or UTC.';
  end if;
  return new;
end $$;

create trigger projects_validate before insert or update of timezone on public.projects
  for each row execute function private.validate_project();

-- Team Leaders may edit the details; only Platform Admins archive or restore, and an
-- archived project stays read-only until it is restored. Trusted SQL sessions
-- (no signed-in user) are not restricted.
create function private.guard_project_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.status is distinct from old.status then
    if not private.is_platform_admin() then
      raise exception using errcode = '42501', message = 'Only a Platform Admin can archive or restore a project.';
    end if;
  elsif old.status = 'archived' then
    raise exception 'This project is archived. A Platform Admin must restore it first.';
  end if;
  return new;
end $$;

create trigger projects_guard_update before update on public.projects
  for each row execute function private.guard_project_update();

create trigger projects_set_updated_at before update on public.projects
  for each row execute function private.set_updated_at();

create function private.guard_project_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'archived' then
    raise exception 'Archive the project before deleting it.';
  end if;
  return old;
end $$;

create trigger projects_guard_delete before delete on public.projects
  for each row execute function private.guard_project_delete();

create function private.log_project_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.id, 'project.created', 'project', new.id, jsonb_build_object('name', new.name));
  elsif new.status is distinct from old.status then
    perform private.log_activity(new.id, case when new.status = 'archived' then 'project.archived' else 'project.restored' end,
      'project', new.id, jsonb_build_object('name', new.name));
  elsif (new.name, new.description, new.timezone) is distinct from (old.name, old.description, old.timezone) then
    perform private.log_activity(new.id, 'project.updated', 'project', new.id, jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;

create trigger projects_log_change after insert or update on public.projects
  for each row execute function private.log_project_change();
