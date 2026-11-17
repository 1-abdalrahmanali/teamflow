# Testing record

Last full run: 17 November 2026, version 2. Everything below passed.

## 1. Database and access rules: 78 checks

`supabase/tests/run.mjs` applies every migration to an in-process Postgres (PGlite) and sends requests straight to the database as a Platform Admin, a person promoted and later demoted, a Team Leader, a member who leads a second project, two members, an outsider, an unconfirmed user and an anonymous visitor. Nothing goes through the UI, so these prove the rules hold for anyone calling the API with the public key.

```bash
cd supabase/tests && npm install && npm test
```

| Area | Examples of what is proven |
| --- | --- |
| Roles | Sign-up is always a plain user, whatever the sign-up data claims. Nobody writes a role column directly. Only Platform Admins change roles, never their own. Only Platform Admins make Team Leaders. Every change is logged. |
| Profiles | People who share no project cannot see each other. A profile photo must sit in the person's own avatars folder. |
| Projects | Only Platform Admins create, archive, restore and delete. Team Leaders edit only the projects they lead. An archived project refuses every change. Time zones must be real. |
| Invitations | Only a SHA-256 hash is stored and it is not readable. Duplicate, wrong-email, unconfirmed, expired, withdrawn and reused invitations are refused. Sending again withdraws the old link. |
| Tasks | Assignees must be project members. A task can start unassigned. Members see only their own tasks; Team Leaders only their project's. Nobody sets a status by hand. |
| Dependencies | Same project only, no self-links, duplicates or loops, nothing added to work already started. A member sees what blocks them without opening the other task. Blocked tasks cannot be started or submitted, even through the API. |
| Resources | Link types need an https link (YouTube links must be YouTube). Files must be in the task's own folder, exist in Storage and have an allowed extension. Members read but never write. A resource stays editable after its file is gone. |
| Discussion | Only people on the task read or post. One level of replies. Authors edit their own posts; managers pin and delete any. Pinning is not an edit. |
| Submissions | Only the assignee submits; versions number 1, 2, 3 and never change. Code, text and file each need their own content. |
| Reviews | Nobody reviews their own work, including a Team Leader assigned a task in their own project. Approval needs a score from 0 to 100; a revision needs feedback and takes no score. One decision per version. |
| Private notes | Readable by the project's Team Leaders and Platform Admins who did not write the work. Never by the author. |
| Numbers | `member_performance` returns exactly Assigned, Completed and Average Score, follows who may see whose numbers, and survives a member's removal. |
| Everything | Anonymous visitors read no table. Row Level Security is on for all 12 tables. |

## 2. The invitation Edge Function: 7 checks

`supabase/tests/functions/send-invitation.test.ts` runs the real handler in Deno against the local stack, with a fake Resend that records each email. It proves: a manager's invitation is emailed with a working link; someone who does not manage the project gets the database's refusal; no sign-in, no invitation; if Resend refuses, the invitation still exists and the link comes back; sending again replaces the link and emails the new one; without email settings the copy-link path works; browsers get CORS headers.

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon key> SUPABASE_JWT_SECRET=<jwt secret> \
  deno run --node-modules-dir=none --allow-net --allow-env supabase/tests/functions/send-invitation.test.ts
```

## 3. Time zones: 8 checks

```bash
node --test tests/unit/*.test.mjs
```

A deadline typed as 23:30 in Cairo is stored as 21:30 UTC and shown again as 23:30 Cairo time. UTC passes straight through; zones with summer time use the offset of that date, including a time skipped when clocks go forward; bad input gives nothing rather than a wrong date; the deadline wording (overdue, due soon, fine, done, none) and zone labels read correctly.

## 4. End to end in a real browser: 28 checks

`tests/e2e/workflow.py` drives the real interface in Chromium (Playwright) as a Platform Admin, a Team Leader and a member, each in their own browser, plus phone-sized browsers. It ran against real Postgres 16, PostgREST 14.1 and Supabase Auth 2.182.1, with the `send-invitation` function running in Deno and a fake Resend. It passed three runs in a row on the same database. The only browser console entry is the expected 400 from the refused dependency loop.

What it walks through:

- **A. Setup.** The Platform Admin lands on Platform overview with only the Admin menu; creates a project in Cairo time; invites two people by email (the email arrives, the token is stored only as a hash); both accept from the email link; a reused link is refused; she makes one of them Team Leader and the change is logged.
- **B. Planning.** The Team Leader lands on Team overview; creates code, text and file tasks (23:30 Cairo is stored as 21:30 UTC); a dependency loop is refused with a readable message; attaches a YouTube video (a non-YouTube link is refused), a PDF and a docs link.
- **C. Work and revision.** The member's dashboard shows exactly three numbers; the dependent task shows Blocked; she watches the video inline, opens the PDF and has no edit buttons; asks a question and cannot pin; starts, writes code in Monaco and submits; the Team Leader's empty change request is refused, then sent with feedback and a private note; he answers and pins the question; the member sees the feedback but never the private note (on the task page and the review page), finds her code already in the editor, fixes it and sends version 2.
- **D. Approval and numbers.** Approval with a score of 90; the dependent task unlocks, a text answer is approved with 70; the dashboard reads 3 assigned, 2 completed, average 80; a file task takes an upload.
- **E. Roles and platform.** The Platform Admin promotes another person, cannot change her own role, and sees it in the log; the platform overview and the invitations list load; Team overview shows the team with their numbers; archiving makes the project read-only and restoring opens it again.
- **Phones.** Member and Team Leader pages at 390 x 844.

Also checked by hand in the browser: member pages (My tasks, My submissions, Projects, Settings, the member's project overview); members sent home from admin and manager pages; inviting and sending again from the Invitations page; and with the function stopped, the invitation is still created and the link shown to copy.

To run it against the Supabase CLI's local stack:

```bash
pip install playwright && playwright install chromium
supabase start && supabase db reset                   # applies supabase/migrations
node tests/e2e/fake_resend.mjs &                      # records emails in tests/e2e/outbox.json
cat > /tmp/fn.env <<'EOF'
RESEND_API_KEY=re_test
INVITE_FROM=TeamFlow <invites@teamflow.test>
APP_URL=http://localhost:8080
RESEND_API_URL=http://host.docker.internal:54399/emails
EOF
supabase functions serve send-invitation --env-file /tmp/fn.env --no-verify-jwt &
python3 -m http.server 8080 &                         # from the project folder
SUPABASE_ANON_KEY=<anon key from `supabase status`> python3 tests/e2e/workflow.py
```

The script deletes every user, project and file before it starts. Never point it at a real project.

## 5. Code checks

- ESLint (undefined names, unused imports, unreachable code): clean across all modules in `js/`.
- Every relative import, named export, page script, stylesheet and in-app link resolves.
- Every Lucide icon name used exists in the pinned version (1.73.0).

## 6. Visual and accessibility checks

Screenshots were reviewed at 1440 x 900 and 390 x 844 for every page above. Fixes made from that review: a class name clash that stretched PDF resources, toast and dialog icons that did not draw, spacing inside project tabs, consistent section headings, the review choice labels wrapping, the reviewer reading the work before the decision form on phones, and resource rows on phones.

Colour contrast was measured, not estimated: faint text (now 5.6:1 on white), green and amber status text on their tinted backgrounds (5.2:1 and 5.3:1) were darkened to pass WCAG AA. The Average Score dial is a half circle filled in proportion to the score, with the number printed in its centre and a text alternative, so colour is never the only signal.
