-- TeamFlow: remove version 1 from a live Supabase project, once, before applying
-- the version 2 migrations. It deletes every version 1 table, function, policy and
-- record, and clears version 1 from the migration history. Sign-in accounts
-- (auth.users) are kept, so people can still log in; version 2 recreates their profiles.
--
-- Files already uploaded to the "submissions" and "avatars" buckets are left in place,
-- because Supabase only lets the Storage API delete them. They become unreachable;
-- empty the buckets from the dashboard (Storage, bucket menu, Empty bucket) if you like.

begin;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_email_changed on auth.users;

drop policy if exists "submission files: assignee uploads" on storage.objects;
drop policy if exists "submission files: author and project owner read" on storage.objects;
drop policy if exists "avatars: read own folder" on storage.objects;
drop policy if exists "avatars: upload to own folder" on storage.objects;
drop policy if exists "avatars: replace own" on storage.objects;
drop policy if exists "avatars: delete own" on storage.objects;

drop function if exists public.create_invitation(uuid, text);
drop function if exists public.revoke_invitation(uuid);
drop function if exists public.get_invitation(text);
drop function if exists public.accept_invitation(text);
drop function if exists public.remove_member(uuid, uuid);
drop function if exists public.start_task(uuid);
drop function if exists public.submit_solution(uuid, text, text, text, text);
drop function if exists public.review_submission(uuid, text, text);
drop function if exists public.dashboard_stats();

drop table if exists public.comments cascade;
drop table if exists public.submissions cascade;
drop table if exists public.tasks cascade;
drop table if exists public.invitations cascade;
drop table if exists public.activity_logs cascade;
drop table if exists public.project_members cascade;
drop table if exists public.projects cascade;
drop table if exists public.profiles cascade;

drop schema if exists private cascade;

-- Forget the version 1 migrations, if the Supabase CLI recorded them.
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version like '20261115%';
  end if;
end $$;

commit;
