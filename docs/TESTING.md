# Testing record

Last full run: 15 November 2026. Everything below passed.

## 1. Database and access rules: 66 checks

`supabase/tests/run.mjs` applies every migration to an in-process Postgres (PGlite) and then sends requests straight to the database as two administrators, two members, an outsider, an unconfirmed user and an anonymous visitor. Nothing goes through the UI, so these prove the rules hold even for someone calling the API directly with the public key.

```bash
cd supabase/tests && npm install && npm test
```

What it covers:

| Area | Examples of what is proven |
| --- | --- |
| Profiles | Sign-up always creates a member, even if the sign-up data claims otherwise. Nobody can promote themselves. People who share no project cannot see each other. |
| Projects | Members cannot create projects. Another administrator cannot see, edit or delete your project. |
| Invitations | Only a token hash is stored and it is not readable through the API. Duplicate, wrong-email, unconfirmed-email, expired, revoked and already-used invitations are all refused. Only the owner can invite or revoke. |
| Tasks | Assigning to a non-member is rejected. Members see only their own tasks. Nobody, not even the owner, can set a status by hand. |
| Submissions | Direct writes are refused. Only the assignee can submit. Versions number 1, 2, 3 and old ones never change. A revision needs feedback. Only approval completes a task. Completed tasks take no more submissions. |
| Files | Uploads only go into the member's own folder for their own file task, and a submission must point at a file that really exists. |
| Comments | Only the owner and the assignee can read or write; no edits, deletes or forged authors. |
| Membership | Removing a member unassigns their open work, keeps their history and ends their access. |
| Everything | Anonymous visitors can read no table. Row Level Security is on for every table. |

## 2. End-to-end in a real browser: 34 checks

`tests/e2e/workflow.py` drives the real interface in Chromium (Playwright) as an administrator, an invited member and a second administrator, each in their own browser. It ran against real Postgres 16, real PostgREST 14.1 and real Supabase Auth 2.182.1. Zero browser console errors.

The run covered: sign-up as a member, promotion by hand, creating a project, creating an invitation link, refusing a duplicate invitation, opening the link signed out, signing up with the prefilled email and joining, refusing a reused link, keeping members out of admin pages, creating code, text and file tasks, starting a task, writing code in Monaco with draft autosave, submitting version 1, a revision request that requires a note, the feedback note on the member's side, resubmitting version 2, approval, the task becoming Completed only then, a text answer, a file upload stored in the right folder, a shared discussion, isolation from a second administrator (even by direct link), archive and restore, sign-out protection, a wrong-password message, and a sign-out in one tab moving the other tab to sign-in.

To re-run it against the Supabase CLI's local stack:

```bash
pip install playwright && playwright install chromium
supabase start && supabase db reset          # applies supabase/migrations
python3 -m http.server 8080                  # from the project folder
SUPABASE_ANON_KEY=<anon key from `supabase status`> python3 tests/e2e/workflow.py
```

The script deletes every user before it starts. Never point it at a real project.

## 3. Code checks

- ESLint (undefined names, unused imports, unreachable code): clean across all 34 modules in `js/`.
- Every relative import, named export, page link and stylesheet resolves.
- Every Lucide icon name used exists in the pinned version (1.73.0).

## 4. Visual checks

Screenshots were reviewed at 1440 x 900 and at phone size (390 x 844) for the landing page, dashboards, the project workspace, the task page with the editor, the review page, invitations, team members and settings. Fixes made from that review: name and detail lines in person chips, a full-height sidebar, the copy-link button wrapping, a visible open/close cue on collapsible sections, compact empty states inside panels, and the discussion moved below the review panel so reviewers on phones reach Approve without scrolling past it.
