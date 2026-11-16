# TeamFlow

A project management and code review platform. An administrator creates projects, invites people by link, assigns tasks and reviews every submitted version. Members write their solution in a built-in code editor (or hand in text, a GitHub link or a file), get feedback and resubmit until the work is approved.

Built with plain HTML, CSS and JavaScript modules on top of Supabase (Auth, Postgres with Row Level Security, Storage). There is no build step and no server of its own.

## How it works

| Who | What they can do |
| --- | --- |
| Administrator | Create, edit, archive and delete their own projects. Invite people with one-time links. Create and assign tasks. Review submissions: approve, or ask for changes with a note. See statistics and activity. |
| Member | See the projects they joined and only the tasks assigned to them. Submit work, see feedback, resubmit. Discuss a task with the project owner. |

Rules the database enforces on every request, not just in the interface:

- Every sign-up is a member. Administrators are promoted by hand (see below), and nobody can promote themselves.
- An administrator cannot see another administrator's projects.
- A task can only be assigned to a member of the same project.
- Only the database functions move a task's status. A task becomes Completed only when its project owner approves a submission.
- Every submission is a new version. Old versions are never changed.
- Invitation links work once, only for the invited email, for 7 days. Only a SHA-256 hash of the token is stored.
- Submitted code is displayed, never executed.

## Set it up

You need a Supabase project and somewhere to host static files (GitHub Pages, Netlify, Cloudflare Pages, or VS Code Live Server for local use).

### 1. Create the database

Run the five files in `supabase/migrations/` **in order** (their names start with a timestamp). Either:

- with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`, or
- in the Supabase dashboard: SQL Editor, paste each file, Run.

This creates the tables, constraints, access rules, the trusted functions and two storage buckets (`submissions`, private, 10 MB per file; `avatars`, public, 2 MB per file).

### 2. Configure sign-in

In the Supabase dashboard, under Authentication:

- **URL Configuration**: set Site URL to where the app is hosted (for example `https://name.github.io/teamflow/`). Under Redirect URLs, add the same address followed by `**` (for example `https://name.github.io/teamflow/**`). Add `http://127.0.0.1:5500/**` too if you use Live Server.
- **Email confirmation** (Sign In / Providers, Email, "Confirm email"): Supabase's built-in email service only delivers to members of your Supabase team, at about 2 emails an hour. So choose one:
  - Set up custom SMTP (Authentication, Emails, SMTP Settings) with a provider such as Resend, and keep "Confirm email" on. This is the safest setup and also makes "Forgot password" work for everyone.
  - Or turn "Confirm email" off. Invitations still work, because the one-time link you send is the proof of who was invited. "Forgot password" emails will not reach people outside your Supabase team; you can reset their password from the dashboard (Authentication, Users).

### 3. Connect the app

Open `js/config/env.js` and fill in the project URL and the **publishable** key (Project Settings, API Keys). Both are safe to publish; Row Level Security is what protects the data.

Never put a secret key (`sb_secret_...`) or the legacy `service_role` key anywhere in this repository.

### 4. Host it

Any static host works. For local use, open the folder in VS Code and start Live Server (the pages use JavaScript modules, so opening the HTML files directly from disk will not work).

### 5. Make yourself the administrator

Sign up through the app first. Then, in the Supabase SQL Editor:

```sql
update public.profiles set platform_role = 'administrator' where email = 'you@example.com';
```

Sign out and back in, and the admin area opens.

## Inviting people

1. Open a project, choose **Invite someone**, enter their email.
2. TeamFlow shows a one-time link (and a ready-made message to copy). Send it however you like.
3. They open the link, sign up or sign in with that email, and press **Join**.

The link is shown only once. If it gets lost, revoke the invitation and create a new one.

## Project structure

```text
index.html, login.html, register.html, forgot-password.html,
reset-password.html, accept-invitation.html, settings.html
admin/      dashboard, projects, project-details (workspace), task-form,
            members, invitations, submissions (review queue), submission-review
member/     dashboard, projects, project-details, tasks, task-details, submissions
css/        variables, main, components, dashboard (layouts), responsive
js/
  config/       env.js (your project URL and publishable key), supabase.js (client)
  auth/         sign-up, sign-in, sessions, page guards
  projects/ members/ invitations/ tasks/ submissions/ comments/
                one data module each: every Supabase call for that area
  components/   layout shell, modal, toast, Monaco editor, comments, versions, dialogs
  utils/        safe HTML rendering, formatting, validation, error messages, links
  pages/        one entry module per HTML page
supabase/
  migrations/   the database, in order
  tests/        database and access-rule tests (66 checks)
tests/e2e/      end-to-end browser tests (34 checks)
docs/           testing record and the handoff prompt
```

Each HTML page loads one module from `js/pages/`. Pages never call Supabase directly; they go through the data modules, which report every error in plain language.

## Testing

See `docs/TESTING.md`. In short:

```bash
# Database rules (no Supabase needed; runs on an in-process Postgres)
cd supabase/tests && npm install && npm test

# Full workflow in a real browser, against the Supabase CLI's local stack
supabase start && supabase db reset
python3 -m http.server 8080            # from the project folder, in another terminal
SUPABASE_ANON_KEY=<from supabase status> python3 tests/e2e/workflow.py
```

## Known limitations

- One administrator per project (the owner). The `admin` membership role exists in the schema for a future co-admin feature.
- Comments cannot be edited or deleted.
- No in-app notifications or emails about reviews; the dashboards show what is waiting.
- Drafts and requirement ticks are saved in the member's browser, not in the database.
- Deleting a user account is done from the Supabase dashboard.
