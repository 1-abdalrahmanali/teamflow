# Handoff prompt: put TeamFlow version 2 live on GitHub and Supabase

Paste everything below the line into the Claude account that is connected to your GitHub and Supabase, and attach TeamFlow.zip (or the TeamFlow folder) with it.

---

You are taking over a finished, tested web app called **TeamFlow** (version 2) and putting it live. Your job is deployment and configuration, not redesign. The code is attached. I am Mahmoud, the owner and the first Platform Admin.

Version 1 of TeamFlow is already deployed: there is a Supabase project with the version 1 database, and probably a GitHub repository with the version 1 code. **The data in it is disposable.** You will replace both with version 2.

## What TeamFlow is

A project platform with three roles:

- **Platform Admin** (a profile setting): manages everything, creates projects, chooses each project's Team Leader, promotes other Platform Admins.
- **Team Leader** (per project): plans tasks with deadlines in the project's time zone, prerequisites between tasks and learning material (YouTube, docs, articles, example projects, PDFs, images, starter code), runs the task discussions, and reviews work: approve with a score from 0 to 100, or send back with feedback, plus private notes that members never see.
- **Member** (joins by an emailed invitation): works on assigned tasks, asks questions, hands in code (Monaco editor), a written answer or a file. Their dashboard shows exactly three numbers: Assigned Tasks, Completed Tasks, Average Score.

Stack: static HTML, CSS and vanilla JavaScript ES modules (no framework, no build step); Supabase Auth, Postgres with Row Level Security, Storage, and one Edge Function (`send-invitation`) that emails invitations through Resend. Libraries load from jsDelivr at pinned versions: `@supabase/supabase-js@2.119.0`, `lucide@1.73.0`, `monaco-editor@0.52.2`.

Read `README.md` and `docs/TESTING.md` first. The build was verified by 78 database tests, 7 Edge Function tests, 8 time zone tests and a 28-step browser test of the whole workflow against real Postgres 16, PostgREST 14.1 and Supabase Auth 2.182.1.

## Decisions already made (do not reopen them)

- There is no GitHub integration in the product. Submissions are code, text or a file only.
- All permissions are enforced in the database (grants, RLS, security-definer functions in a `private` schema with a fixed search path). The frontend only hides what would fail anyway.
- The Edge Function holds no key that can bypass RLS. It calls the database with the inviter's own sign-in, so the database makes every permission check. Its only secret is the Resend API key.
- If email is not set up or fails, inviting still works: the app shows the link to copy.
- `js/config/env.js` is committed on purpose. It holds only the project URL and the publishable key, both public by design.

## Ask me these things first, in one message

1. **Resend.** Do I already have a Resend account with a verified domain? If not, I need to create one and verify a domain I own (Resend, Domains, add the DNS records it shows). Without a verified domain, Resend only delivers to my own address. Ask me for: the API key (I will paste it to you or set it myself), and the sender I want, for example `TeamFlow <invites@mydomain.com>`.
2. **GitHub.** Is there already a TeamFlow repository? If yes, which one. If not, the name for a new one (suggest `teamflow`) and whether it can be public (GitHub Pages on a free account needs a public repository; otherwise offer Netlify or Cloudflare Pages).

If I do not have a verified domain yet, carry on with everything else and leave the email steps for later; the app works with copy-link invitations meanwhile.

## Steps

### 1. Code on GitHub

Replace the repository's contents with the attached version 2, exactly as it is, in one commit (for example "TeamFlow version 2"). Version 1 files that no longer exist must be deleted, in particular the `admin/` and `member/` folders, the root `settings.html`, and the old migrations `supabase/migrations/20261115*.sql`. Do not commit `node_modules`. Keep `js/config/env.js` as is for now (step 4 fills it in).

### 2. Replace the database

The Supabase project already holds version 1. Do this in order and stop if anything fails:

1. Run `supabase/teardown/drop_v1.sql` once with your SQL tool (not as a migration). It removes the version 1 tables, functions, triggers, storage policies and migration records. It **keeps the people** (`auth.users`) and the storage buckets.
2. Apply the seven files in `supabase/migrations/` in filename order with your apply-migration tool. Use each file name without `.sql` as the migration name and the content exactly as written. Do not edit, merge or "fix" them.
   1. `20261117000100_profiles`
   2. `20261117000200_projects`
   3. `20261117000300_tasks`
   4. `20261117000400_submissions`
   5. `20261117000500_security`
   6. `20261117000600_functions`
   7. `20261117000700_storage`
3. Verify and show me the results:

```sql
-- Expect 12 rows, every one with rls_enabled = true
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1;

-- Expect: avatars (public, 2 MB), submissions (private, 10 MB), task-resources (private, 20 MB)
select id, public, file_size_limit from storage.buckets order by id;

-- Expect 19 functions
select count(*), string_agg(proname, ', ' order by proname)
from pg_proc where pronamespace = 'public'::regnamespace;

-- Expect one profile per existing account, all with platform_role = 'user'
select email, platform_role from public.profiles order by email;
```

4. Run the security and performance advisors. Report what they flag, but do not change the schema to silence a warning without asking me. Expected and harmless: `SECURITY DEFINER` functions (deliberate; the `private` ones are not exposed through the API, and the `public` ones check the caller themselves) and `get_invitation` being callable by anonymous visitors (the invitation page needs it before sign-in; it reveals nothing without the secret token).
5. Old version 1 files may still sit in the `submissions` and `avatars` buckets. Supabase does not allow deleting them with SQL. Tell me they can be removed from the dashboard (Storage, select the files, Delete) if I want a clean start; nothing depends on them.

### 3. Email (when I have a verified Resend domain)

**a. Auth emails (confirmations, password resets).** In Authentication, Emails, SMTP Settings, turn on custom SMTP:

- Host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key
- Sender email on my verified domain, sender name `TeamFlow`

Keep "Confirm email" on. Check the email rate limit under Authentication, Rate Limits and tell me its value.

**b. Invitation emails (the Edge Function).** Deploy `supabase/functions/send-invitation/` (three files: `index.ts`, `handler.ts`, `email.ts`) as the function `send-invitation`, with JWT verification on. Then set its secrets (Edge Functions, Secrets, or `supabase secrets set`):

| Secret | Value |
| --- | --- |
| `RESEND_API_KEY` | the Resend API key |
| `INVITE_FROM` | the sender, for example `TeamFlow <invites@mydomain.com>` |
| `APP_URL` | the live site address from step 5, without a trailing slash |

Supabase provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the function automatically; do not add a service role or secret key.

If inviting later fails with `401` and "Invalid JWT", redeploy the function with JWT verification off (`--no-verify-jwt`, or `verify_jwt: false`). That is safe for this function: it does nothing without a valid session, because it calls the database as the caller and the database refuses anyone who cannot invite.

### 4. Connect the app

Get the project URL and the **publishable** key (`sb_publishable_...`; if the project only shows legacy keys, use the legacy `anon` key). Put them in `js/config/env.js`, then commit and push that one change:

```js
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
```

Never put a secret key (`sb_secret_...`) or the legacy `service_role` key in the repository, in `env.js`, or anywhere in the frontend.

### 5. Hosting

If the site is already on GitHub Pages, it redeploys from the push; wait for it. Otherwise turn on GitHub Pages: deploy from `main`, root folder. Tell me the live address. The app works under a sub-path such as `https://<user>.github.io/teamflow/`; all links are relative.

### 6. Auth URLs

Authentication, URL Configuration: Site URL = the live address. Redirect URLs: the live address followed by `/**`. If your tools cannot change Auth settings, give me the exact clicks and wait.

### 7. Make me the first Platform Admin

My account from version 1 is still there. Run:

```sql
update public.profiles set platform_role = 'platform_admin' where email = '<my email>';
select email, platform_role from public.profiles;
```

If my email is not in the list, ask me to sign up on the live site first. Then tell me to sign out and back in. From then on I promote others myself on the Users and roles page; there is no need to run SQL again.

### 8. Smoke test with me

Walk me through this and check each result. I will use a second and third email address I own.

1. I land on Platform overview. I create a project and choose its time zone.
2. I invite my second address. The dialog says it was emailed, and the email arrives with a Join link. (Without email set up, it says to copy the link instead.)
3. In a private window, I open the link, sign up with that address and join. I invite and join my third address the same way.
4. In the project's People tab, I make the second account Team Leader.
5. As the Team Leader: create a code task for the third account with a deadline, a second task that must wait for the first, and add a YouTube link and a PDF to the first task.
6. As the member: the second task shows Blocked. On the first task I watch the video, ask a question, start, write code and submit version 1.
7. As the Team Leader: send it back with feedback and a private note, and answer and pin the question.
8. As the member: I see the feedback but not the private note, fix the code and submit version 2.
9. As the Team Leader: approve with a score. The second task unblocks. The member's dashboard shows 2 assigned, 1 completed and that score.

If a step fails, look at the browser console and the Supabase logs (API, Auth, Edge Functions) before changing anything, then tell me the cause and the smallest fix.

## Rules for any later change

- Keep fixes minimal and targeted. Change only what the problem needs.
- Any database change goes in a new migration file in `supabase/migrations/` with a later timestamp than `20261117000700`, applied through the migration tool. Never edit an applied migration and never change the live schema by hand.
- Never turn off Row Level Security, never widen a grant, never use the secret key to make a feature work, and never execute submitted code.
- Keep the no-framework, no-build-step setup.
- If you change database rules, run `cd supabase/tests && npm install && npm test` and keep it passing; add a test for the new rule.

## If something looks wrong

| What I see | Likely cause |
| --- | --- |
| "One step left" on every page | `js/config/env.js` still has the placeholders, or the new version has not deployed yet. |
| Pages from version 1 (`admin/...`, `member/...`) still open | Old files were not deleted from the repository in step 1. |
| Inviting shows "was not emailed" | The function is not deployed, its secrets are missing, or Resend refused the sender. The Edge Function logs say which. The link in the dialog still works. |
| Inviting fails with "Invalid JWT" | Redeploy the function with JWT verification off (step 3b). |
| The invitation email never arrives | The sender is not on a verified Resend domain, or it went to spam. Resend's dashboard shows each attempt. |
| Sign-up says to check email, but nothing arrives | Custom SMTP is not set (step 3a), or the email rate limit was reached. |
| The email link opens an error or the wrong site | Site URL or Redirect URLs (step 6), or `APP_URL` for invitations, do not match the live address. |
| I only see My work, not Admin | The promotion SQL has not run for my email, or I have not signed out and back in. |
| "You are signed in as ..., but this invitation is for ..." | The invited person is signed in with another account. They should sign out and use the invited email. |
| Pages are blank when opened from a local folder | The pages use JavaScript modules and need a web server. Use the live site or VS Code Live Server. |
| The code editor shows a plain text box | jsDelivr could not be reached. The fallback still submits correctly. |
