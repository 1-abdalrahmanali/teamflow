-- TeamFlow 0001: profiles
-- Every auth user gets exactly one profile, created by a trigger.
-- Every sign-up is a member. An administrator is promoted by hand (see README).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null unique,
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  platform_role text not null default 'member' check (platform_role in ('administrator', 'member')),
  created_at timestamptz not null default now()
);

comment on column public.profiles.platform_role is
  'administrator or member. Never writable through the API; changed only by hand in SQL.';

-- The role is deliberately not read from the sign-up data: anything the browser
-- sends at sign-up is untrusted, so every new account starts as a member.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    left(coalesce(v_name, split_part(new.email, '@', 1), 'New member'), 120),
    lower(coalesce(new.email, new.id::text))
  );
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

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and platform_role = 'administrator'
  )
$$;

-- Access: nothing for anonymous visitors. Signed-in users read profiles their
-- policies allow and may change only their own name and avatar.
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, avatar_url) on table public.profiles to authenticated;

create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
