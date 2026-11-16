# Handoff prompt: publish TeamFlow to GitHub and Supabase

Paste everything below the line into the Claude account that is connected to your GitHub and Supabase, and attach the TeamFlow folder (or TeamFlow.zip) with it.

---

You are taking over a finished, tested web app called **TeamFlow** and putting it live. Your job is deployment and configuration, not redesign. The code is attached. I am Mahmoud, the owner; I will be the only administrator.

## What TeamFlow is

A project management and code review platform. An administrator creates projects, invites people with one-time links, assigns tasks, and reviews each submitted version (approve, or ask for changes with a note). Members submit work in a Monaco code editor, or as text, a GitHub link or a file, and resubmit until approved.

Stack: static HTML, CSS and vanilla JavaScript ES modules (no framework, no build step), Supabase Auth, Postgres with Row Level Security, and Supabase Storage. Libraries load from jsDelivr at pinned versions: `@supabase/supabase-js@2.119.0`, `lucide@1.73.0`, `monaco-editor@0.52.2`.

Read `README.md` and `docs/TESTING.md` before you start. The database rules were verified by 66 database tests and 34 end-to-end browser tests against real Postgres 16, PostgREST 14.1 and Supabase Auth 2.182.1.

## Decisions already made (do not reopen them)

- Every sign-up is a member. I promote myself to administrator by hand with one SQL statement. There is only one administrator: me.
- Invitations are links I send myself. There is no email service for invitations and no Edge Function.
- All permissions are enforced in the database (grants, RLS, and security-definer functions in a `private` schema). The frontend only hides what would fail anyway.
- `js/config/env.js` is committed to the repository on purpose. It holds only the project URL and the publishable key, both of which are public by design. The site is static, so there is no other way to give it these values.

## Ask me these two things first, in one message

1. GitHub: the repository name (suggest `teamflow`) and whether it can be public. GitHub Pages on a free account needs a public repository; if I want it private, offer Netlify or Cloudflare Pages instead.
2. Email confirmation. Supabase's built-in email only reaches members of my Supabase team, about 2 emails an hour, so invited people would never get their confirmation email. Offer these two options and wait for my choice:
   - **A (recommended if I can do it):** I create a free Resend account and verify a domain, you set it as custom SMTP, and "Confirm email" stays on. "Forgot password" then works for everyone.
   - **B (works today):** turn "Confirm email" off. Invitations still work because the one-time link is the proof. "Forgot password" will not reach people outside my Supabase team; I would reset their passwords from the dashboard.

Then do the rest without asking unless something fails.

## Steps

### 1. GitHub

Create the repository and push every attached file exactly as it is, keeping the folder structure. Do not commit `node_modules`. The `.gitignore` is already there.

### 2. Supabase project

Create a new project named `TeamFlow` in the region closest to Cairo (Frankfurt, `eu-central-1`), on the free plan. If your tools ask you to confirm a cost, show me the cost and wait for my yes.

### 3. Database

Apply the five files in `supabase/migrations/` in filename order, using your Supabase connector's apply-migration tool. Use each file name without `.sql` as the migration name, and the file content exactly as written. Do not edit, merge or "fix" them.

1. `20261115000100_profiles`
2. `20261115000200_schema`
3. `20261115000300_security`
4. `20261115000400_functions`
5. `20261115000500_storage`

Then verify, and show me the results:

```sql
-- Expect 8 rows, every one with rls_enabled = true
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1;

-- Expect: avatars (public) and submissions (private)
select id, public, file_size_limit from storage.buckets order by id;

-- Expect 9 functions
select proname from pg_proc where pronamespace = 'public'::regnamespace order by 1;
```

Run the security and performance advisors. Report anything they flag, but do not change the schema to silence a warning without asking me. Some notices are expected and harmless, for example that functions in the `private` schema are `SECURITY DEFINER`: that is deliberate, and they are not exposed through the API.

### 4. Connect the app

Get the project URL and the **publishable** key (`sb_publishable_...`). If the project only shows legacy keys, create the publishable key in Project Settings, API Keys, or use the legacy `anon` key as a fallback. Put them in `js/config/env.js`:

```js
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
```

Commit and push that one change.

Never put a secret key (`sb_secret_...`) or the legacy `service_role` key in the repository, in `env.js`, or anywhere in the frontend.

### 5. Hosting

Turn on GitHub Pages for the repository: deploy from the `main` branch, root folder. Wait until the site is live and tell me the address. The app works under a sub-path such as `https://<user>.github.io/teamflow/`; all links are relative.

### 6. Auth settings

Set these in Supabase. If your tools cannot change Auth settings, give me the exact clicks instead and wait while I do them.

- Authentication, URL Configuration: Site URL = the live address from step 5. Redirect URLs: add the live address followed by `**` (for example `https://<user>.github.io/teamflow/**`).
- Email provider enabled, sign-ups allowed.
- "Confirm email": on or off, according to my answer to question 2. For option A, set custom SMTP with my Resend details (host `smtp.resend.com`, port 465, user `resend`, password = my Resend API key, sender on my verified domain).

### 7. Make me the administrator

Ask me to open the live site and sign up. When I say I have, run:

```sql
update public.profiles set platform_role = 'administrator' where email = '<the email I signed up with>';
select email, platform_role from public.profiles;
```

Tell me to sign out and back in.

### 8. Smoke test with me

Walk me through this and check each result:

1. I land on the admin dashboard and create a project.
2. I invite a second email address I own and copy the link.
3. In a private window, I open the link, sign up with that email and press Join.
4. I create a code task assigned to that account.
5. As the member, I start the task, write code in the editor and submit version 1.
6. As the admin, I ask for changes with a note.
7. As the member, I see the note and submit version 2.
8. As the admin, I approve. The task shows Completed for both of us.

If any step fails, look at the browser console and the Supabase logs (API and Auth) before changing anything, then tell me the cause and the smallest fix.

## Rules for any later change

- Keep fixes minimal and targeted. Change only what the problem needs.
- Any database change goes in a new migration file in `supabase/migrations/`, named with a later timestamp than `20261115000500`, applied through the migration tool. Never edit an applied migration and never change the live schema by hand.
- Never turn off Row Level Security, never widen a grant, and never use the secret key to make a feature work.
- Keep the no-framework, no-build-step setup.
- If you change database rules, run the database tests (`cd supabase/tests && npm install && npm test`) and keep them passing; add a test for the new rule.

## If something looks wrong

| What I see | Likely cause |
| --- | --- |
| "One step left" on every page | `js/config/env.js` still has the placeholders, or the new version has not deployed yet. |
| Sign-up says to check email, but nothing arrives | Built-in email only reaches Supabase team members. Use option A, or turn "Confirm email" off. |
| The email link opens an error or the wrong site | Site URL or Redirect URLs in Auth settings do not match the live address. |
| I signed up but only see the member area | The promotion SQL has not run for my email, or I have not signed out and back in. |
| "This invitation was sent to a different email address" | The invited person signed in with another account. They should sign out and use the invited email. |
| Pages are blank when opened from a local folder | The pages use JavaScript modules and need a web server. Use the live site or VS Code Live Server. |
| The code editor shows a plain text box | jsDelivr could not be reached. The fallback still submits correctly. |
