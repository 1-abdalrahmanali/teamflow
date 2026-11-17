# TeamFlow

A project platform for teams that learn and build together. Platform Admins create projects and choose a Team Leader for each one. Team Leaders plan the work: tasks with deadlines in the team's time zone, the order tasks must happen in, and learning material (videos, docs, example projects, starter files). Members ask questions in each task's discussion, hand in code, a written answer or a file, and get it back with notes or approved with a score from 0 to 100.

Plain HTML, CSS and JavaScript modules on Supabase (Auth, Postgres with Row Level Security, Storage and one Edge Function for invitation emails). No build step.

## Who does what

| Role | Where it comes from | What it allows |
| --- | --- | --- |
| Platform Admin | Set on the person's profile. The first one is set by hand (below); after that, Platform Admins promote others on the Users and roles page. | Everything: create, archive, restore and delete projects; make people Team Leaders; invite to any project; review any work; see every project and the platform overview. |
| Team Leader | Per project. A Platform Admin makes a member Team Leader in the project's People tab. | In that project: create and assign tasks, set prerequisites, add learning material, invite people, remove members, review work, pin posts, read private reviewer notes. |
| Member | Joining a project through an invitation. | See their own tasks, open the material, ask and answer in discussions, hand in work, see their reviews and their three numbers. |

One person can hold different roles in different projects. Every role change is recorded in the activity log.

Rules the database enforces on every request, not just in the interface:

- Nobody can change their own role. Only Platform Admins change roles.
- Members see only the tasks assigned to them. Team Leaders see the projects they lead; Platform Admins see everything.
- Nobody reviews their own work. A Team Leader assigned a task in their own project needs another Team Leader or a Platform Admin to review it.
- Private reviewer notes are never returned to the person who wrote the work.
- A task with unfinished prerequisites cannot be started or submitted. Dependency loops are refused.
- Approving needs a score from 0 to 100. Sending work back needs written feedback.
- Every submission is a new version; old versions never change. Only an approval completes a task.
- Invitation links work once, only for the invited email, for 7 days. Only a SHA-256 hash of the token is stored.
- An archived project is read-only for everyone until a Platform Admin restores it.
- Submitted code is shown, never run.

## Set it up

The full, ordered checklist (including replacing an older TeamFlow database) is in `docs/HANDOFF-PROMPT.md`. In short:

1. **Database.** Run `supabase/migrations/*.sql` in order (`supabase db push`, or paste each file in the SQL Editor). If an earlier TeamFlow version is installed, run `supabase/teardown/drop_v1.sql` first. It keeps the people (auth users) and removes everything else.
2. **Sign-in.** In Authentication, URL Configuration, set the Site URL to where the app is hosted and add `<that address>/**` to Redirect URLs.
3. **Email.** Verify a domain in Resend, then use it twice:
   - Authentication, Emails, SMTP Settings: host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key. This sends sign-up confirmations and password resets.
   - The `send-invitation` Edge Function sends invitations. Deploy it and set its secrets:
     ```bash
     supabase functions deploy send-invitation
     supabase secrets set RESEND_API_KEY=re_... INVITE_FROM="TeamFlow <invites@yourdomain.com>" APP_URL=https://your-site.example
     ```
     If inviting fails with `401 Invalid JWT`, redeploy with `--no-verify-jwt`. That is safe here: the function calls the database as the signed-in inviter, and the database checks every permission.
   Without email, invitations still work: the app shows the link to copy and send yourself.
4. **Connect the app.** Put the project URL and the publishable key in `js/config/env.js`. Never put a secret key anywhere in this repository.
5. **Host it** on any static host (GitHub Pages, Netlify, Cloudflare Pages). For local use, serve the folder (for example with VS Code Live Server); opening the files from disk will not work.
6. **First Platform Admin.** Sign up in the app, then run in the SQL Editor:
   ```sql
   update public.profiles set platform_role = 'platform_admin' where email = 'you@example.com';
   ```
   Sign out and back in.

## A project's life

1. A Platform Admin creates the project and picks its time zone.
2. They invite people by email from the project (or the Invitations page). Each person opens the emailed link, signs up or signs in with that address, and joins as a member.
3. In the People tab, the Platform Admin makes someone Team Leader.
4. The Team Leader creates tasks: the brief, requirements (one per line, shown to the member as a checklist), a deadline, how work is handed in, and which tasks must finish first. On the task page they attach learning material.
5. The member starts the task, asks questions, and submits. The Team Leader approves it with a score, or sends it back with notes and, if useful, a private note for other reviewers.
6. Everyone's dashboard shows exactly three numbers: Assigned Tasks, Completed Tasks, Average Score.

## Project structure

```text
index.html, login.html, register.html, forgot-password.html,
reset-password.html, accept-invitation.html     public pages
app/            signed-in pages: home (redirect), dashboard, tasks, submissions,
                projects, project (workspace with tabs), task, task-form,
                review, review-queue, leading, settings
app/admin/      overview, users (users and roles), invitations
css/            variables, main, components, dashboard (layouts), tasks (v2 pieces), responsive
js/
  config/       env.js (your project URL and publishable key), supabase.js (the client)
  auth/         sign-in and sessions, access.js (who can do what), guards.js (page guards)
  projects/ members/ users/ invitations/ tasks/ resources/ discussions/
  submissions/ performance/
                one data module per area: every Supabase call for that area
  components/   layout (role-aware sidebar), dialogs, Monaco editor, resources and
                discussion panels, version history, small UI pieces
  utils/        safe HTML rendering, time zones, formatting, validation, error messages, links
  pages/        one entry module per HTML page
supabase/
  migrations/   the database, in order
  teardown/     drop_v1.sql, to replace an older TeamFlow database
  functions/    send-invitation (the invitation email)
  tests/        database and access-rule tests, and the function's tests
tests/
  unit/         time zone tests
  e2e/          the whole workflow in a real browser
docs/           testing record, the handoff prompt, the build plan
```

Each HTML page loads one module from `js/pages/`. Pages never call Supabase directly; they use the data modules, which turn every error into a sentence a person can act on.

## Testing

See `docs/TESTING.md`. In short:

```bash
cd supabase/tests && npm install && npm test        # 78 database and access-rule checks
node --test tests/unit/*.test.mjs                   # 8 time zone checks
```

The function tests and the browser tests need a local Supabase stack; `docs/TESTING.md` has the commands.

## Known limitations

- No in-app notifications. Dashboards, the review queue and the counts in the sidebar show what is waiting.
- Requirement ticks and unsent drafts are saved in the person's browser, not in the database.
- Deleting a user account is done from the Supabase dashboard. Their completed work and scores stay in the history.
- Files removed from a task are deleted from Storage; files of deleted projects stay in Storage until removed from the dashboard.
