// TeamFlow database tests.
// Applies every migration to an in-process Postgres (PGlite) and then sends
// requests straight to the database as different people, the way an attacker
// with the public key could. Nothing here goes through the UI.
//
//   cd supabase/tests && npm install && npm test

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const db = new PGlite();

await db.exec(readFileSync(join(here, 'support', 'supabase_stub.sql'), 'utf8'));
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  } catch (error) {
    console.error(`Migration ${file} failed: ${error.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- helpers

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

function eq(actual, expected, label = 'value') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Runs one statement as a signed-in user, as an anonymous visitor, or as the service.
async function run(role, userId, sql, params = []) {
  return db.transaction(async (tx) => {
    if (role !== 'service') {
      await tx.exec(`set local role ${role}`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    }
    return (await tx.query(sql, params)).rows;
  });
}
const as = (userId, sql, params) => run('authenticated', userId, sql, params);
const anon = (sql, params) => run('anon', null, sql, params);
const service = (sql, params) => run('service', null, sql, params);

async function denied(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    if (pattern && !pattern.test(error.message)) throw new Error(`rejected, but with the wrong error: ${error.message}`);
    return;
  }
  throw new Error('expected the request to be rejected, but it succeeded');
}

async function signUp(email, fullName, { confirmed = true, extraMeta = {} } = {}) {
  const meta = JSON.stringify({ full_name: fullName, ...extraMeta });
  const [user] = await service(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
     values ($1, $2::jsonb, ${confirmed ? 'now()' : 'null'}) returning id`,
    [email, meta],
  );
  return user.id;
}

const invite = async (ownerId, projectId, email) =>
  (await as(ownerId, `select public.create_invitation($1, $2) as r`, [projectId, email]))[0].r;
const accept = (userId, token) => as(userId, `select public.accept_invitation($1) as project_id`, [token]);
const submit = async (userId, taskId, content, language, filePath = null, fileName = null) =>
  (await as(userId, `select public.submit_solution($1, $2, $3, $4, $5) as r`, [taskId, content, language, filePath, fileName]))[0].r;
const review = (userId, submissionId, decision, feedback = null) =>
  as(userId, `select public.review_submission($1, $2, $3)`, [submissionId, decision, feedback]);
const taskStatus = async (taskId) => (await service(`select status from public.tasks where id = $1`, [taskId]))[0].status;

// ---------------------------------------------------------------- people

const adminA = await signUp('amira@example.com', 'Amira Adel', { extraMeta: { platform_role: 'administrator' } });
const adminB = await signUp('basel@example.com', 'Basel Nour');
const mona = await signUp('mona@example.com', 'Mona Farid');
const nabil = await signUp('nabil@example.com', 'Nabil Saad');
const omar = await signUp('omar@example.com', 'Omar Outsider');
const uma = await signUp('uma@example.com', 'Uma Unconfirmed', { confirmed: false });

// ---------------------------------------------------------------- profiles

console.log('\nProfiles and platform role');

await test('sign-up always creates a member profile, whatever the sign-up data claims', async () => {
  const [profile] = await service(`select platform_role, full_name, email from public.profiles where id = $1`, [adminA]);
  eq(profile, { platform_role: 'member', full_name: 'Amira Adel', email: 'amira@example.com' });
});

// Admins are promoted by hand, exactly as the handoff instructions do it.
await service(`update public.profiles set platform_role = 'administrator' where id in ($1, $2)`, [adminA, adminB]);

await test('a user cannot promote themselves to administrator', () =>
  denied(as(mona, `update public.profiles set platform_role = 'administrator' where id = $1`, [mona]), /permission denied/));

await test('a user can edit their own name but not anyone else\'s', async () => {
  eq((await as(mona, `update public.profiles set full_name = 'Mona F.' where id = $1 returning id`, [mona])).length, 1, 'own rows');
  eq((await as(mona, `update public.profiles set full_name = 'Hacked' where id = $1 returning id`, [nabil])).length, 0, 'other rows');
});

await test('people who share no project cannot see each other', async () => {
  eq((await as(mona, `select id from public.profiles`)).map((r) => r.id), [mona]);
});

// ---------------------------------------------------------------- projects

console.log('\nProjects');

let projA;
let projB;

await test('a member cannot create a project', () =>
  denied(as(mona, `insert into public.projects (name) values ('Sneaky project')`), /row-level security/));

await test('an administrator creates a project and becomes its first member', async () => {
  [{ id: projA }] = await as(adminA, `insert into public.projects (name, description) values ('Website relaunch', 'New marketing site') returning id`);
  eq(await service(`select user_id, role from public.project_members where project_id = $1`, [projA]), [{ user_id: adminA, role: 'admin' }]);
});

await test('nobody can create a project in someone else\'s name', () =>
  denied(as(adminA, `insert into public.projects (name, owner_id) values ('Forged', $1)`, [adminB]), /permission denied/));

[{ id: projB }] = await as(adminB, `insert into public.projects (name) values ('Mobile app') returning id`);

await test('another administrator cannot see, edit or delete the project', async () => {
  eq((await as(adminB, `select id from public.projects where id = $1`, [projA])).length, 0, 'select');
  eq((await as(adminB, `update public.projects set name = 'Mine now' where id = $1 returning id`, [projA])).length, 0, 'update');
  eq((await as(adminB, `delete from public.projects where id = $1 returning id`, [projA])).length, 0, 'delete');
});

await test('someone outside the project cannot see it', async () => {
  eq((await as(omar, `select id from public.projects`)).length, 0);
});

// ---------------------------------------------------------------- invitations

console.log('\nInvitations');

let monaInvite;
let nabilToken;

await test('the owner creates an invitation and only a hash of the token is stored', async () => {
  monaInvite = await invite(adminA, projA, '  Mona@Example.com ');
  assert(/^[0-9a-f]{64}$/.test(monaInvite.token), 'token should be 64 hex characters');
  const [row] = await service(`select email, token_hash, status from public.invitations where id = $1`, [monaInvite.invitation_id]);
  eq(row, { email: 'mona@example.com', token_hash: createHash('sha256').update(monaInvite.token).digest('hex'), status: 'pending' });
});

await test('a duplicate pending invitation is rejected', () =>
  denied(invite(adminA, projA, 'mona@example.com'), /already a pending invitation/));

await test('only the project owner can invite', async () => {
  await denied(invite(adminB, projA, 'x@example.com'), /Only the project owner/);
  await denied(invite(mona, projA, 'x@example.com'), /Only the project owner/);
});

await test('an invalid email address is rejected', () => denied(invite(adminA, projA, 'not-an-email'), /valid email/));

await test('the stored token hash is not readable through the API', () =>
  denied(as(adminA, `select token_hash from public.invitations`), /permission denied/));

await test('the owner lists invitations and other administrators see none', async () => {
  eq((await as(adminA, `select id from public.invitations where project_id = $1`, [projA])).length, 1, 'owner');
  eq((await as(adminB, `select id from public.invitations`)).length, 0, 'other admin');
});

await test('the invitation preview works before sign-in and reveals nothing for a bad token', async () => {
  const [{ r }] = await anon(`select public.get_invitation($1) as r`, [monaInvite.token]);
  eq([r.project_name, r.email, r.status, r.invited_by_name], ['Website relaunch', 'mona@example.com', 'pending', 'Amira Adel']);
  eq((await anon(`select public.get_invitation('nope') as r`))[0].r, null);
});

await test('a different account cannot accept the invitation', () =>
  denied(accept(nabil, monaInvite.token), /different email/));

await test('an anonymous visitor cannot accept the invitation', () =>
  denied(anon(`select public.accept_invitation($1)`, [monaInvite.token]), /permission denied/));

await test('an account with an unconfirmed email cannot accept', async () => {
  const umaInvite = await invite(adminA, projA, 'uma@example.com');
  await denied(accept(uma, umaInvite.token), /Confirm your email/);
});

await test('the invited person accepts and is added once', async () => {
  eq((await accept(mona, monaInvite.token))[0].project_id, projA);
  eq((await service(`select role from public.project_members where project_id = $1 and user_id = $2`, [projA, mona])), [{ role: 'member' }]);
  eq((await service(`select status from public.invitations where id = $1`, [monaInvite.invitation_id]))[0].status, 'accepted');
});

await test('an accepted invitation cannot be used again', () => denied(accept(mona, monaInvite.token), /already been used/));

await test('someone already in the project cannot be invited again', () =>
  denied(invite(adminA, projA, 'mona@example.com'), /already in this project/));

await test('an expired invitation is rejected, and a fresh one can replace it', async () => {
  const stale = await invite(adminA, projA, 'nabil@example.com');
  await service(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [stale.invitation_id]);
  await denied(accept(nabil, stale.token), /expired/);
  eq((await anon(`select public.get_invitation($1) as r`, [stale.token]))[0].r.status, 'expired');
  nabilToken = (await invite(adminA, projA, 'nabil@example.com')).token;
  eq((await service(`select status from public.invitations where id = $1`, [stale.invitation_id]))[0].status, 'expired');
});

await test('a revoked invitation is rejected, and only the owner can revoke', async () => {
  const omarInvite = await invite(adminA, projA, 'omar@example.com');
  await denied(as(adminB, `select public.revoke_invitation($1)`, [omarInvite.invitation_id]), /Only the project owner/);
  await as(adminA, `select public.revoke_invitation($1)`, [omarInvite.invitation_id]);
  await denied(accept(omar, omarInvite.token), /withdrawn/);
  await denied(as(adminA, `select public.revoke_invitation($1)`, [omarInvite.invitation_id]), /no longer pending/);
});

await accept(nabil, nabilToken);

await test('members cannot read invitations', async () => {
  eq((await as(mona, `select id from public.invitations`)).length, 0);
});

await test('teammates: members see the owner, the owner sees members, members do not see each other', async () => {
  eq((await as(mona, `select id from public.profiles order by email`)).map((r) => r.id), [adminA, mona]);
  eq((await as(adminA, `select id from public.profiles order by email`)).map((r) => r.id), [adminA, mona, nabil]);
});

await test('nobody can add or change membership rows directly', async () => {
  await denied(as(omar, `insert into public.project_members (project_id, user_id) values ($1, $2)`, [projA, omar]), /permission denied/);
  await denied(as(mona, `update public.project_members set role = 'admin' where user_id = $1`, [mona]), /permission denied/);
});

// ---------------------------------------------------------------- tasks

console.log('\nTasks');

let taskMona;
let taskNabil;

await test('the owner creates a task and assigns it to a member', async () => {
  const [task] = await as(
    adminA,
    `insert into public.tasks (project_id, title, requirements, assigned_to, priority, submission_type, programming_language)
     values ($1, 'Build the login page', 'Email and password fields', $2, 'high', 'code', 'html') returning id, status`,
    [projA, mona],
  );
  taskMona = task.id;
  eq(task.status, 'todo');
  [{ id: taskNabil }] = await as(
    adminA,
    `insert into public.tasks (project_id, title, assigned_to, submission_type) values ($1, 'Share the API repo', $2, 'github_link') returning id`,
    [projA, nabil],
  );
});

await test('assigning a task to someone outside the project is rejected', () =>
  denied(
    as(adminA, `insert into public.tasks (project_id, title, assigned_to) values ($1, 'Outsider task', $2)`, [projA, omar]),
    /tasks_assignee_is_project_member/,
  ));

await test('a member sees only the tasks assigned to them', async () => {
  eq((await as(mona, `select id from public.tasks`)).map((r) => r.id), [taskMona]);
  eq((await as(nabil, `select id from public.tasks where id = $1`, [taskMona])).length, 0, 'teammate');
});

await test('members cannot create, edit or delete tasks', async () => {
  await denied(as(mona, `insert into public.tasks (project_id, title, assigned_to) values ($1, 'My own task', $2)`, [projA, mona]), /row-level security/);
  eq((await as(mona, `update public.tasks set title = 'Easier task' where id = $1 returning id`, [taskMona])).length, 0, 'update');
  eq((await as(mona, `delete from public.tasks where id = $1 returning id`, [taskMona])).length, 0, 'delete');
});

await test('nobody sets a task status by hand, not even the owner', async () => {
  await denied(as(adminA, `update public.tasks set status = 'completed' where id = $1`, [taskMona]), /permission denied/);
  await denied(as(mona, `update public.tasks set status = 'completed' where id = $1`, [taskMona]), /permission denied/);
});

await test('another administrator cannot read or change the task', async () => {
  eq((await as(adminB, `select id from public.tasks`)).length, 0, 'select');
  eq((await as(adminB, `update public.tasks set title = 'x' where id = $1 returning id`, [taskMona])).length, 0, 'update');
});

await test('only the assignee can start a task', async () => {
  await denied(as(nabil, `select public.start_task($1)`, [taskMona]), /assigned to you/);
  await as(mona, `select public.start_task($1)`, [taskMona]);
  eq(await taskStatus(taskMona), 'in_progress');
});

// ---------------------------------------------------------------- submissions

console.log('\nSubmissions and review');

let sub1;
let sub2;

await test('direct writes to the submissions table are refused', () =>
  denied(
    as(mona, `insert into public.submissions (task_id, user_id, code, version) values ($1, $2, 'x', 1)`, [taskMona, mona]),
    /permission denied/,
  ));

await test('someone else cannot submit for the task', () =>
  denied(submit(nabil, taskMona, '<p>mine</p>', 'html'), /assigned to you/));

await test('empty code and unknown languages are rejected', async () => {
  await denied(submit(mona, taskMona, '   ', 'html'), /empty/);
  await denied(submit(mona, taskMona, '<p>hi</p>', 'cobol'), /language/);
});

await test('the assignee submits version 1 and the task becomes Submitted', async () => {
  const result = await submit(mona, taskMona, '<form>v1</form>', 'html');
  sub1 = result.id;
  eq(result.version, 1);
  eq(await taskStatus(taskMona), 'submitted');
});

await test('a second submission is blocked while one awaits review', () =>
  denied(submit(mona, taskMona, '<form>again</form>', 'html'), /waiting for review/));

await test('members and other administrators cannot review', async () => {
  await denied(review(mona, sub1, 'approve'), /Only the project owner/);
  await denied(review(adminB, sub1, 'approve'), /Only the project owner/);
});

await test('a revision request needs written feedback', () =>
  denied(review(adminA, sub1, 'request_revision', '   '), /feedback/));

await test('requesting a revision updates the submission and the task together', async () => {
  await review(adminA, sub1, 'request_revision', 'Please add a password field.');
  const [row] = await service(`select review_status, feedback, reviewed_by, reviewed_at is not null as stamped from public.submissions where id = $1`, [sub1]);
  eq(row, { review_status: 'revision_requested', feedback: 'Please add a password field.', reviewed_by: adminA, stamped: true });
  eq(await taskStatus(taskMona), 'revision_required');
});

await test('a reviewed submission cannot be reviewed twice', () =>
  denied(review(adminA, sub1, 'approve'), /already been reviewed/));

await test('the member resubmits as version 2 and version 1 is kept untouched', async () => {
  const result = await submit(mona, taskMona, '<form>v2 with password</form>', 'html');
  sub2 = result.id;
  eq(result.version, 2);
  eq(
    await service(`select version, code, review_status from public.submissions where task_id = $1 order by version`, [taskMona]),
    [
      { version: 1, code: '<form>v1</form>', review_status: 'revision_requested' },
      { version: 2, code: '<form>v2 with password</form>', review_status: 'pending' },
    ],
  );
});

await test('approval, and only approval, completes the task', async () => {
  eq(await taskStatus(taskMona), 'submitted');
  await review(adminA, sub2, 'approve', 'Looks good.');
  eq(await taskStatus(taskMona), 'completed');
  eq((await service(`select review_status, reviewed_by from public.submissions where id = $1`, [sub2]))[0], { review_status: 'approved', reviewed_by: adminA });
});

await test('a completed task accepts no more submissions', () =>
  denied(submit(mona, taskMona, '<form>v3</form>', 'html'), /already completed/));

await test('submissions are visible to their author and the owner only', async () => {
  eq((await as(mona, `select version from public.submissions order by version`)).map((r) => r.version), [1, 2], 'author');
  eq((await as(nabil, `select id from public.submissions`)).length, 0, 'teammate');
  eq((await as(adminA, `select id from public.submissions where task_id = $1`, [taskMona])).length, 2, 'owner');
  eq((await as(adminB, `select id from public.submissions`)).length, 0, 'other admin');
});

await test('GitHub link tasks accept only GitHub repository links', async () => {
  await denied(submit(nabil, taskNabil, 'http://example.com/repo', null), /GitHub/);
  eq((await submit(nabil, taskNabil, 'https://github.com/nabil/teamflow-api', null)).version, 1);
});

// ---------------------------------------------------------------- file uploads

console.log('\nFile uploads');

let taskFile;

await test('uploads go only into the assignee\'s own folder for their own task', async () => {
  [{ id: taskFile }] = await as(
    adminA,
    `insert into public.tasks (project_id, title, assigned_to, submission_type) values ($1, 'Upload the design file', $2, 'file_upload') returning id`,
    [projA, mona],
  );
  const put = (userId, path) => as(userId, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [path]);
  await put(mona, `${taskFile}/${mona}/design.zip`);
  await denied(put(nabil, `${taskFile}/${nabil}/design.zip`), /row-level security/);
  await denied(put(mona, `${taskNabil}/${mona}/design.zip`), /row-level security/);
  await denied(put(mona, `${taskFile}/${nabil}/design.zip`), /row-level security/);
  await denied(put(mona, `not-a-task/${mona}/design.zip`), /row-level security/);
});

await test('a file submission must point at a file the member really uploaded', async () => {
  await denied(submit(mona, taskFile, null, null, `${taskFile}/${nabil}/design.zip`, 'design.zip'), /upload/i);
  await denied(submit(mona, taskFile, null, null, `${taskFile}/${mona}/missing.zip`, 'missing.zip'), /upload/i);
  eq((await submit(mona, taskFile, null, null, `${taskFile}/${mona}/design.zip`, 'design.zip')).version, 1);
});

await test('uploaded files are readable by their author and the owner only', async () => {
  const visible = (userId) => as(userId, `select name from storage.objects where bucket_id = 'submissions'`);
  eq((await visible(mona)).length, 1, 'author');
  eq((await visible(adminA)).length, 1, 'owner');
  eq((await visible(nabil)).length, 0, 'teammate');
  eq((await visible(adminB)).length, 0, 'other admin');
});

await test('avatars can only be written into the user\'s own folder', async () => {
  await as(mona, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${mona}/avatar.png`]);
  await denied(as(mona, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${nabil}/avatar.png`]), /row-level security/);
});

// ---------------------------------------------------------------- comments

console.log('\nComments');

await test('the assignee and the owner can discuss a task, and nobody else can read or write', async () => {
  eq((await as(mona, `insert into public.comments (task_id, content) values ($1, 'Is a remember-me box needed?') returning user_id`, [taskMona]))[0].user_id, mona);
  await as(adminA, `insert into public.comments (task_id, content) values ($1, 'Not for this version.')`, [taskMona]);
  await denied(as(nabil, `insert into public.comments (task_id, content) values ($1, 'Hello')`, [taskMona]), /row-level security/);
  eq((await as(mona, `select id from public.comments where task_id = $1`, [taskMona])).length, 2, 'assignee');
  eq((await as(nabil, `select id from public.comments`)).length, 0, 'teammate');
  eq((await as(adminB, `select id from public.comments`)).length, 0, 'other admin');
});

await test('comments cannot be edited, deleted or written in someone else\'s name', async () => {
  await denied(as(mona, `update public.comments set content = 'edited'`), /permission denied/);
  await denied(as(mona, `delete from public.comments`), /permission denied/);
  await denied(as(mona, `insert into public.comments (task_id, content, user_id) values ($1, 'forged', $2)`, [taskMona, adminA]), /permission denied/);
});

// ---------------------------------------------------------------- reassignment and removal

console.log('\nReassignment and member removal');

let taskOpen;

await test('a completed task cannot be reassigned', () =>
  denied(as(adminA, `update public.tasks set assigned_to = $2 where id = $1`, [taskMona, nabil]), /Completed tasks/));

await test('a task that is waiting for review cannot be reassigned', () =>
  denied(as(adminA, `update public.tasks set assigned_to = $2 where id = $1`, [taskNabil, mona]), /waiting for review/));

await test('reassigning open work sends it back to Todo', async () => {
  [{ id: taskOpen }] = await as(adminA, `insert into public.tasks (project_id, title, assigned_to) values ($1, 'Style the dashboard', $2) returning id`, [projA, mona]);
  await as(mona, `select public.start_task($1)`, [taskOpen]);
  await as(adminA, `update public.tasks set assigned_to = $2 where id = $1`, [taskOpen, nabil]);
  eq(await taskStatus(taskOpen), 'todo');
});

await test('only the owner removes members, and the owner cannot be removed', async () => {
  await denied(as(mona, `select public.remove_member($1, $2)`, [projA, nabil]), /Only the project owner/);
  await denied(as(adminA, `select public.remove_member($1, $2)`, [projA, adminA]), /owner cannot be removed/);
});

await test('removing a member unassigns their tasks, keeps their submissions and ends their access', async () => {
  await as(nabil, `select public.start_task($1)`, [taskOpen]);
  await as(adminA, `select public.remove_member($1, $2)`, [projA, nabil]);
  eq(await service(`select assigned_to, status from public.tasks where id = $1`, [taskOpen]), [{ assigned_to: null, status: 'todo' }], 'open task');
  eq(await service(`select assigned_to, status from public.tasks where id = $1`, [taskNabil]), [{ assigned_to: null, status: 'submitted' }], 'submitted task');
  eq((await service(`select id from public.submissions where user_id = $1`, [nabil])).length, 1, 'history kept');
  eq((await as(nabil, `select id from public.projects`)).length, 0, 'project access');
  eq((await as(nabil, `select id from public.submissions`)).length, 0, 'submission access');
  eq((await as(nabil, `select id from public.tasks`)).length, 0, 'task access');
});

// ---------------------------------------------------------------- activity and dashboard

console.log('\nActivity and dashboard');

await test('activity is recorded by the database and scoped to the right people', async () => {
  const actions = (await as(adminA, `select action from public.activity_logs where project_id = $1`, [projA])).map((r) => r.action);
  for (const expected of ['project.created', 'invitation.created', 'member.joined', 'task.created', 'submission.submitted', 'submission.revision_requested', 'submission.approved', 'member.removed']) {
    assert(actions.includes(expected), `missing activity: ${expected}`);
  }
  const monaRows = await as(mona, `select user_id from public.activity_logs`);
  assert(monaRows.length > 0 && monaRows.every((r) => r.user_id === mona), 'a member should see only their own activity');
  eq((await as(adminB, `select id from public.activity_logs where project_id = $1`, [projA])).length, 0, 'other admin');
  await denied(as(mona, `insert into public.activity_logs (project_id, action, entity_type) values ($1, 'fake', 'task')`, [projA]), /permission denied/);
});

await test('dashboard numbers follow what each person is allowed to see', async () => {
  const [{ s: admin }] = await as(adminA, `select public.dashboard_stats() as s`);
  eq([admin.total_projects, admin.active_projects, admin.total_tasks, admin.completed_tasks, admin.pending_reviews], [1, 1, 4, 1, 2], 'admin');
  const [{ s: member }] = await as(mona, `select public.dashboard_stats() as s`);
  eq([member.total_projects, member.total_tasks, member.completed_tasks], [1, 2, 1], 'member');
});

// ---------------------------------------------------------------- archive and delete

console.log('\nArchive and delete');

await test('an archived project accepts no new invitations, tasks or submissions', async () => {
  const [{ id: openTask }] = await as(adminA, `insert into public.tasks (project_id, title, assigned_to) values ($1, 'Write the docs', $2) returning id`, [projA, mona]);
  eq((await as(adminA, `update public.projects set status = 'archived' where id = $1 returning id`, [projA])).length, 1);
  await denied(invite(adminA, projA, 'late@example.com'), /archived/);
  await denied(as(adminA, `insert into public.tasks (project_id, title) values ($1, 'Late task')`, [projA]), /row-level security/);
  await denied(submit(mona, openTask, 'notes', null), /archived/);
  await as(adminA, `update public.projects set status = 'active' where id = $1`, [projA]);
});

await test('deleting a project removes everything under it', async () => {
  eq((await as(adminA, `delete from public.projects where id = $1 returning id`, [projA])).length, 1);
  const [counts] = await service(
    `select (select count(*)::int from public.tasks where project_id = $1) as tasks,
            (select count(*)::int from public.submissions) as submissions,
            (select count(*)::int from public.comments) as comments,
            (select count(*)::int from public.invitations where project_id = $1) as invitations,
            (select count(*)::int from public.activity_logs where project_id = $1) as activity,
            (select count(*)::int from public.project_members where project_id = $1) as members`,
    [projA],
  );
  eq(counts, { tasks: 0, submissions: 0, comments: 0, invitations: 0, activity: 0, members: 0 });
  eq((await service(`select id from public.projects where id = $1`, [projB])).length, 1, 'other projects untouched');
});

// ---------------------------------------------------------------- anonymous access and RLS coverage

console.log('\nAnonymous access and RLS coverage');

const tables = ['profiles', 'projects', 'project_members', 'invitations', 'tasks', 'submissions', 'comments', 'activity_logs'];

await test('anonymous visitors can read no table', async () => {
  for (const table of tables) await denied(anon(`select 1 from public.${table}`), /permission denied/);
});

await test('anonymous visitors cannot call the signed-in actions', async () => {
  await denied(anon(`select public.dashboard_stats()`), /permission denied/);
  await denied(anon(`select public.create_invitation($1, 'x@example.com')`, [projB]), /permission denied/);
  await denied(anon(`select public.submit_solution($1, 'x', 'html', null, null)`, [taskMona]), /permission denied/);
});

await test('row level security is enabled on every public table', async () => {
  const unprotected = await service(
    `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
  );
  eq(unprotected, []);
  eq((await service(`select count(*)::int as n from pg_tables where schemaname = 'public'`))[0].n, tables.length, 'table count');
});

// ---------------------------------------------------------------- summary

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed:\n' + failures.map((name) => `  - ${name}`).join('\n'));
  process.exit(1);
}
