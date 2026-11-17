-- TeamFlow v2, 0100: profiles and the platform role.
-- Every sign-in account has one profile, made by a trigger. Every new account
-- starts as a plain user; Platform Admins are made through set_platform_role
-- (the very first one by hand, see README).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  email text not null unique,
  -- Only a photo in the person's own folder of the avatars bucket, so a profile can never
  -- point everyone's browser at an outside address.
  avatar_url text check (
    avatar_url is null
    or (char_length(avatar_url) <= 500
        and avatar_url ~ '^https?://[^/?#]+/storage/v1/object/public/avatars/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
        and split_part(split_part(avatar_url, '/avatars/', 2), '/', 1) = id::text)
  ),
  platform_role text not null default 'user' check (platform_role in ('user', 'platform_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.platform_role is
  'user or platform_admin. Never writable through the API; changed only by set_platform_role.';

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Anything the browser sends at sign-up is untrusted, so the role is never read from it.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, left(coalesce(v_name, split_part(new.email, '@', 1), 'New member'), 120), lower(coalesce(new.email, new.id::text)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Accounts that existed before this rebuild keep working.
insert into public.profiles (id, full_name, email)
select u.id,
       left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), 'Member'), 120),
       lower(coalesce(u.email, u.id::text))
from auth.users u
on conflict (id) do nothing;

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and platform_role = 'platform_admin'
  )
$$;
