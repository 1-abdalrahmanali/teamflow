// TeamFlow version 2 database tests.
// Applies every migration to an in-process Postgres (PGlite), then sends requests
// straight to the database as different people, the way anyone holding the public
// key could. Nothing here goes through the UI.
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

// Compares values with object keys in a fixed order, since Postgres jsonb sorts its keys.
const canonical = (value) =>
  Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
      : value;

function eq(actual, expected, label = 'value') {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

const one = async (promise) => (await promise)[0];
const invite = async (by, projectId, email) => (await one(as(by, `select public.create_invitation($1, $2) as r`, [projectId, email]))).r;
const accept = (userId, token) => as(userId, `select public.accept_invitation($1) as project_id`, [token]);
const joinProject = async (by, projectId, userId, email) => accept(userId, (await invite(by, projectId, email)).token);
const setProjectRole = (by, projectId, userId, role) => as(by, `select public.set_project_role($1, $2, $3)`, [projectId, userId, role]);
const setPlatformRole = (by, userId, role) => as(by, `select public.set_platform_role($1, $2)`, [userId, role]);
const newTask = async (by, projectId, fields) => {
  const cols = ['project_id', ...Object.keys(fields)];
  const vals = [projectId, ...Object.values(fields)];
  const sql = `insert into public.tasks (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`;
  return (await one(as(by, sql, vals))).id;
};
const depend = (by, taskId, dependsOn) => as(by, `select public.add_task_dependency($1, $2) as id`, [taskId, dependsOn]);
const submitCode = async (by, taskId, code, language = 'javascript') =>
  (await one(as(by, `select public.submit_solution($1, $2, $3, null, null, null) as r`, [taskId, code, language]))).r;
const submitText = async (by, taskId, text) =>
  (await one(as(by, `select public.submit_solution($1, null, null, $2, null, null) as r`, [taskId, text]))).r;
const submitFile = async (by, taskId, path, name) =>
  (await one(as(by, `select public.submit_solution($1, null, null, null, $2, $3) as r`, [taskId, path, name]))).r;
const review = (by, submissionId, decision, feedback = null, score = null, note = null) =>
  as(by, `select public.review_submission($1, $2, $3, $4, $5)`, [submissionId, decision, feedback, score, note]);
const perf = async (by, userId, projectId = null) =>
  (await one(as(by, `select public.member_performance($1, $2) as p`, [userId, projectId]))).p;
const status = async (taskId) => (await one(service(`select status from public.tasks where id = $1`, [taskId]))).status;
const count = async (who, sql, params) => (await as(who, sql, params)).length;

// ---------------------------------------------------------------- people

const amira = await signUp('amira@example.com', 'Amira Adel', { extraMeta: { platform_role: 'platform_admin' } });
const basel = await signUp('basel@example.com', 'Basel Nour');
const layla = await signUp('layla@example.com', 'Layla Hassan');
const mona = await signUp('mona@example.com', 'Mona Farid');
const nabil = await signUp('nabil@example.com', 'Nabil Saad');
const omar = await signUp('omar@example.com', 'Omar Outsider');
const uma = await signUp('uma@example.com', 'Uma Unconfirmed', { confirmed: false });

// ================================================================ profiles and roles

console.log('\nProfiles and platform roles');

await test('every sign-up is a plain user, whatever the sign-up data claims', async () => {
  eq((await one(service(`select platform_role from public.profiles where id = $1`, [amira]))).platform_role, 'user');
});

// The very first Platform Admin is set by hand, exactly as the deployment instructions do it.
await service(`update public.profiles set platform_role = 'platform_admin' where id = $1`, [amira]);

await test('nobody can write platform_role directly, not even an admin', async () => {
  await denied(as(mona, `update public.profiles set platform_role = 'platform_admin' where id = $1`, [mona]), /permission denied/);
  await denied(as(amira, `update public.profiles set platform_role = 'platform_admin' where id = $1`, [basel]), /permission denied/);
});

await test('people edit their own name and nobody else\'s', async () => {
  eq(await count(mona, `update public.profiles set full_name = 'Mona F.' where id = $1 returning id`, [mona]), 1, 'own');
  eq(await count(mona, `update public.profiles set full_name = 'Hacked' where id = $1 returning id`, [nabil]), 0, 'other');
  await service(`update public.profiles set full_name = 'Mona Farid' where id = $1`, [mona]);
});

await test('a profile photo must come from the person\'s own avatars folder', async () => {
  const own = `https://ref.supabase.co/storage/v1/object/public/avatars/${mona}/avatar-1.png`;
  eq(await count(mona, `update public.profiles set avatar_url = $2 where id = $1 returning id`, [mona, own]), 1, 'own folder');
  await denied(as(mona, `update public.profiles set avatar_url = $2 where id = $1`, [mona, 'https://tracker.example/pixel.gif']), /profiles_avatar_url_check|check constraint/);
  await denied(
    as(mona, `update public.profiles set avatar_url = $2 where id = $1`, [mona, `https://ref.supabase.co/storage/v1/object/public/avatars/${nabil}/a.png`]),
    /profiles_avatar_url_check|check constraint/,
  );
  await service(`update public.profiles set avatar_url = null where id = $1`, [mona]);
});

await test('a non-admin cannot promote anyone to Platform Admin', () =>
  denied(setPlatformRole(mona, mona, 'platform_admin'), /Only a Platform Admin/));

await test('a Platform Admin promotes another user, and the change is audited', async () => {
  await setPlatformRole(amira, basel, 'platform_admin');
  eq((await one(service(`select platform_role from public.profiles where id = $1`, [basel]))).platform_role, 'platform_admin');
  const [log] = await service(`select project_id, metadata->>'to' as to_role from public.activity_logs where action = 'role.platform_changed' and entity_id = $1`, [basel]);
  eq(log, { project_id: null, to_role: 'platform_admin' }, 'audit');
});

await test('nobody changes their own platform role', () => denied(setPlatformRole(amira, amira, 'user'), /your own role/));

await test('an unknown role value is refused', () => denied(setPlatformRole(amira, mona, 'superuser'), /role/));

// ================================================================ projects (scenario A)

console.log('\nProjects');

let projA;
let projB;

await test('a plain user cannot create a project', () =>
  denied(as(mona, `insert into public.projects (name) values ('Sneaky')`), /row-level security/));

await test('a Platform Admin creates two independent projects', async () => {
  projA = (await one(as(amira, `insert into public.projects (name, description, timezone) values ('Website relaunch', 'Marketing site', 'Africa/Cairo') returning id, created_by`))).id;
  projB = (await one(as(amira, `insert into public.projects (name, timezone) values ('Mobile app', 'UTC') returning id`))).id;
  eq((await one(service(`select created_by from public.projects where id = $1`, [projA]))).created_by, amira, 'created_by');
});

await test('a made-up time zone is refused', () =>
  denied(as(amira, `insert into public.projects (name, timezone) values ('Bad zone', 'Mars/Olympus')`), /time zone/));

await test('Platform Admins see every project without being members; outsiders see none', async () => {
  eq(await count(basel, `select id from public.projects`), 2, 'other admin');
  eq(await count(omar, `select id from public.projects`), 0, 'outsider');
});

// ================================================================ invitations

console.log('\nInvitations');

let laylaInvite;

await test('an admin invites by email and only a hash of the token is stored', async () => {
  laylaInvite = await invite(amira, projA, '  Layla@Example.com ');
  assert(/^[0-9a-f]{64}$/.test(laylaInvite.token), 'token should be 64 hex characters');
  eq([laylaInvite.email, laylaInvite.project_name, laylaInvite.inviter_name], ['layla@example.com', 'Website relaunch', 'Amira Adel']);
  const [row] = await service(`select token_hash, status from public.invitations where id = $1`, [laylaInvite.invitation_id]);
  eq(row, { token_hash: createHash('sha256').update(laylaInvite.token).digest('hex'), status: 'pending' });
});

await test('the token hash cannot be read through the API', () =>
  denied(as(amira, `select token_hash from public.invitations`), /permission denied/));

await test('a duplicate pending invitation and a bad email are refused', async () => {
  await denied(invite(amira, projA, 'layla@example.com'), /already a pending invitation/);
  await denied(invite(amira, projA, 'not-an-email'), /valid email/);
});

await test('people who do not manage the project cannot invite', async () => {
  await denied(invite(mona, projA, 'x@example.com'), /manage this project/);
  await denied(invite(omar, projA, 'x@example.com'), /manage this project/);
});

await test('the preview works before sign-in and a bad token reveals nothing', async () => {
  const preview = (await one(anon(`select public.get_invitation($1) as r`, [laylaInvite.token]))).r;
  eq([preview.project_name, preview.status, preview.invited_by_name], ['Website relaunch', 'pending', 'Amira Adel']);
  eq((await one(anon(`select public.get_invitation('nope') as r`))).r, null);
});

await test('the wrong account, an unconfirmed account and visitors cannot accept', async () => {
  await denied(accept(mona, laylaInvite.token), /different email/);
  await denied(anon(`select public.accept_invitation($1)`, [laylaInvite.token]), /permission denied/);
  const umaInvite = await invite(amira, projA, 'uma@example.com');
  await denied(accept(uma, umaInvite.token), /Confirm your email/);
});

await test('the invited person joins once, as a member', async () => {
  eq((await one(accept(layla, laylaInvite.token))).project_id, projA);
  eq((await service(`select role from public.project_members where project_id = $1 and user_id = $2`, [projA, layla])), [{ role: 'member' }]);
  await denied(accept(layla, laylaInvite.token), /already been used/);
  await denied(invite(amira, projA, 'layla@example.com'), /already in this project/);
});

await test('expired and revoked links are refused', async () => {
  const stale = await invite(amira, projA, 'omar@example.com');
  await service(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [stale.invitation_id]);
  await denied(accept(omar, stale.token), /expired/);
  const fresh = await invite(amira, projA, 'omar@example.com');
  await as(amira, `select public.revoke_invitation($1)`, [fresh.invitation_id]);
  await denied(accept(omar, fresh.token), /withdrawn/);
});

await test('sending again replaces the old link with a new one', async () => {
  const first = await invite(amira, projB, 'nabil@example.com');
  const second = (await one(as(amira, `select public.resend_invitation($1) as r`, [first.invitation_id]))).r;
  assert(second.token !== first.token, 'a new token');
  await denied(accept(nabil, first.token), /withdrawn/);
  eq((await one(accept(nabil, second.token))).project_id, projB);
});

// Remaining memberships: A = Layla, Mona, Nabil; B = Mona, Nabil.
await joinProject(amira, projA, mona, 'mona@example.com');
await joinProject(amira, projA, nabil, 'nabil@example.com');
await joinProject(amira, projB, mona, 'mona@example.com');

await test('memberships cannot be written directly', async () => {
  await denied(as(omar, `insert into public.project_members (project_id, user_id) values ($1, $2)`, [projA, omar]), /permission denied/);
  await denied(as(mona, `update public.project_members set role = 'team_leader' where user_id = $1`, [mona]), /permission denied/);
});

// ================================================================ team leaders (scenario A)

console.log('\nTeam Leaders');

await test('only a Platform Admin makes a Team Leader, and only of an existing member', async () => {
  await denied(setProjectRole(layla, projA, layla, 'team_leader'), /Only a Platform Admin/);
  await denied(setProjectRole(amira, projA, omar, 'team_leader'), /not a member/);
  await setProjectRole(amira, projA, layla, 'team_leader');
  await setProjectRole(amira, projB, mona, 'team_leader');
});

await test('project roles are independent: Mona leads B and is still a member of A', async () => {
  eq(await service(`select project_id = $1 as in_a, role from public.project_members where user_id = $2 order by role`, [projA, mona]),
    [{ in_a: true, role: 'member' }, { in_a: false, role: 'team_leader' }]);
  eq((await one(service(`select platform_role from public.profiles where id = $1`, [layla]))).platform_role, 'user', 'platform role untouched');
});

await test('a Team Leader cannot promote anyone, in their project or to Platform Admin', async () => {
  await denied(setProjectRole(layla, projA, nabil, 'team_leader'), /Only a Platform Admin/);
  await denied(setPlatformRole(layla, nabil, 'platform_admin'), /Only a Platform Admin/);
});

await test('role changes are audited with the project', async () => {
  eq(await count(amira, `select id from public.activity_logs where action = 'role.project_changed' and project_id = $1`, [projA]), 1);
});

await test('members see their team\'s names; outsiders see only themselves and admins', async () => {
  const seen = (await as(nabil, `select full_name from public.profiles order by full_name`)).map((r) => r.full_name);
  eq(seen, ['Amira Adel', 'Basel Nour', 'Layla Hassan', 'Mona Farid', 'Nabil Saad']);
  eq((await as(omar, `select full_name from public.profiles order by full_name`)).map((r) => r.full_name), ['Amira Adel', 'Basel Nour', 'Omar Outsider']);
});

await test('a Team Leader manages invitations for their project only', async () => {
  const leaderInvite = await invite(layla, projA, 'omar@example.com');
  eq(await count(layla, `select id from public.invitations where project_id = $1`, [projA]) > 0, true, 'reads own project invitations');
  eq(await count(layla, `select id from public.invitations where project_id = $1`, [projB]), 0, 'not other projects');
  await denied(invite(layla, projB, 'x@example.com'), /manage this project/);
  await as(layla, `select public.revoke_invitation($1)`, [leaderInvite.invitation_id]);
  eq(await count(nabil, `select id from public.invitations`), 0, 'members read none');
});

// ================================================================ tasks (scenario B)

console.log('\nTasks');

let tDb;
let tBackend;
let tApi;

await test('a Team Leader creates tasks with deadlines and assignees', async () => {
  tDb = await newTask(layla, projA, { title: 'Database design', assigned_to: nabil, priority: 'high', deadline: '2026-11-20T21:30:00Z', submission_type: 'code', programming_language: 'sql' });
  tBackend = await newTask(layla, projA, { title: 'Backend development', assigned_to: mona, submission_type: 'text' });
  tApi = await newTask(layla, projA, { title: 'API integration', assigned_to: nabil, submission_type: 'file' });
  eq((await one(service(`select created_by, status from public.tasks where id = $1`, [tDb]))), { created_by: layla, status: 'todo' });
});

await test('a task can start unassigned, visible to managers only', async () => {
  const draft = await newTask(layla, projA, { title: 'Testing' });
  eq(await count(layla, `select id from public.tasks where id = $1`, [draft]), 1, 'leader');
  eq(await count(nabil, `select id from public.tasks where id = $1`, [draft]), 0, 'member');
  await as(layla, `delete from public.tasks where id = $1`, [draft]);
});

await test('members and leaders of other projects cannot create tasks', async () => {
  await denied(newTask(nabil, projA, { title: 'My own task' }), /row-level security/);
  await denied(newTask(layla, projB, { title: 'Wrong project' }), /row-level security/);
});

await test('assigning a task to a non-member is refused', () =>
  denied(newTask(layla, projA, { title: 'Outsider task', assigned_to: omar }), /tasks_assignee_is_project_member/));

await test('members see only their own tasks; leaders see their project\'s tasks only', async () => {
  eq(await count(mona, `select id from public.tasks`), 1, 'mona');
  eq(await count(nabil, `select id from public.tasks`), 2, 'nabil');
  eq(await count(mona, `select id from public.tasks where project_id = $1`, [projA]), 1, 'mona does not see teammates\' tasks');
});

await test('nobody writes a task status directly, and members cannot edit tasks', async () => {
  await denied(as(layla, `update public.tasks set status = 'completed' where id = $1`, [tDb]), /permission denied/);
  eq(await count(nabil, `update public.tasks set title = 'Easier' where id = $1 returning id`, [tDb]), 0, 'member edit');
  eq(await count(nabil, `update public.tasks set deadline = now() + interval '30 days' where id = $1 returning id`, [tDb]), 0, 'member deadline');
});

// ================================================================ dependencies

console.log('\nDependencies');

await test('a leader chains tasks: Backend needs Database, API needs Backend', async () => {
  await depend(layla, tBackend, tDb);
  await depend(layla, tApi, tBackend);
  eq(await count(layla, `select id from public.task_dependencies`), 2);
});

await test('self-links, duplicates, cross-project links and cycles are refused', async () => {
  await denied(depend(layla, tDb, tDb), /cannot depend on itself/);
  await denied(depend(layla, tBackend, tDb), /already depends/);
  const bTask = await newTask(amira, projB, { title: 'Mobile login' });
  await denied(depend(amira, tDb, bTask), /same project/);
  await denied(depend(layla, tDb, tApi), /loop/);
});

await test('members cannot add or remove dependencies, or write the table directly', async () => {
  await denied(depend(nabil, tApi, tDb), /manage this project/);
  await denied(as(layla, `insert into public.task_dependencies (task_id, depends_on_task_id) values ($1, $2)`, [tDb, tApi]), /permission denied/);
});

await test('a member sees what blocks them without opening the other task', async () => {
  const rows = await as(mona, `select title, status, assignee_name from public.task_prerequisites($1)`, [tBackend]);
  eq(rows, [{ title: 'Database design', status: 'todo', assignee_name: 'Nabil Saad' }]);
  eq(await count(mona, `select id from public.tasks where id = $1`, [tDb]), 0, 'cannot open it');
  await denied(as(mona, `select * from public.task_prerequisites($1)`, [tApi]), /not available/);
});

await test('blocked tasks are reported in one call, only for tasks you can open', async () => {
  eq((await as(mona, `select public.blocked_tasks($1) as id`, [[tBackend, tApi, tDb]])).map((r) => r.id), [tBackend]);
  eq((await as(layla, `select public.blocked_tasks($1) as id`, [[tBackend, tApi, tDb]])).map((r) => r.id).sort(), [tBackend, tApi].sort());
});

await test('a blocked task cannot start or take a submission, even through the API', async () => {
  await denied(as(mona, `select public.start_task($1)`, [tBackend]), /blocked/);
  await denied(submitText(mona, tBackend, 'Early answer'), /blocked/);
});

await test('a prerequisite cannot be added to work that already started', async () => {
  await as(nabil, `select public.start_task($1)`, [tDb]);
  const extra = await newTask(layla, projA, { title: 'Write the schema docs' });
  await denied(depend(layla, tDb, extra), /already started/);
  await as(layla, `delete from public.tasks where id = $1`, [extra]);
});

// ================================================================ resources

console.log('\nLearning resources');

let pdfPath;

await test('a leader adds link resources; bad links are refused', async () => {
  await as(layla, `insert into public.task_resources (task_id, title, resource_type, external_url) values ($1, 'Normalization in 10 minutes', 'youtube', 'https://www.youtube.com/watch?v=GFQaEYEc8_8')`, [tDb]);
  await as(layla, `insert into public.task_resources (task_id, title, resource_type, external_url) values ($1, 'Postgres docs', 'documentation', 'https://www.postgresql.org/docs/')`, [tDb]);
  await denied(as(layla, `insert into public.task_resources (task_id, title, resource_type, external_url) values ($1, 'Fake video', 'youtube', 'https://example.com/video')`, [tDb]), /task_resources_youtube_link/);
  await denied(as(layla, `insert into public.task_resources (task_id, title, resource_type, external_url) values ($1, 'Plain http', 'article', 'http://example.com')`, [tDb]), /task_resources_content/);
});

await test('a leader uploads a PDF into the task\'s folder and attaches it', async () => {
  pdfPath = `${projA}/${tDb}/abc-schema.pdf`;
  await as(layla, `insert into storage.objects (bucket_id, name) values ('task-resources', $1)`, [pdfPath]);
  await as(layla, `insert into public.task_resources (task_id, title, resource_type, storage_path, file_name) values ($1, 'Schema template', 'pdf', $2, 'schema.pdf')`, [tDb, pdfPath]);
});

await test('a resource path must sit under its own task and match its type', async () => {
  const elsewhere = `${projA}/${tBackend}/abc-other.pdf`;
  await as(layla, `insert into storage.objects (bucket_id, name) values ('task-resources', $1)`, [elsewhere]);
  await denied(as(layla, `insert into public.task_resources (task_id, title, resource_type, storage_path, file_name) values ($1, 'Wrong folder', 'pdf', $2, 'other.pdf')`, [tDb, elsewhere]), /folder/);
  await denied(as(layla, `insert into public.task_resources (task_id, title, resource_type, storage_path, file_name) values ($1, 'Missing file', 'pdf', $2, 'missing.pdf')`, [tDb, `${projA}/${tDb}/missing.pdf`]), /upload/i);
  const png = `${projA}/${tDb}/abc-diagram.png`;
  await as(layla, `insert into storage.objects (bucket_id, name) values ('task-resources', $1)`, [png]);
  await denied(as(layla, `insert into public.task_resources (task_id, title, resource_type, storage_path, file_name) values ($1, 'Not a pdf', 'pdf', $2, 'diagram.png')`, [tDb, png]), /file type/);
});

await test('members cannot upload resource files into someone else\'s folder or anywhere', async () => {
  await denied(as(nabil, `insert into storage.objects (bucket_id, name) values ('task-resources', $1)`, [`${projA}/${tDb}/abc-mine.pdf`]), /row-level security/);
  await denied(as(layla, `insert into storage.objects (bucket_id, name) values ('task-resources', $1)`, [`${projB}/${tDb}/abc-x.pdf`]), /row-level security/);
});

await test('the assignee reads resources and files; other members and outsiders cannot', async () => {
  eq(await count(nabil, `select id from public.task_resources where task_id = $1`, [tDb]), 3, 'assignee');
  eq(await count(mona, `select id from public.task_resources where task_id = $1`, [tDb]), 0, 'teammate');
  eq(await count(nabil, `select name from storage.objects where bucket_id = 'task-resources' and name = $1`, [pdfPath]), 1, 'file');
  eq(await count(mona, `select name from storage.objects where bucket_id = 'task-resources' and name = $1`, [pdfPath]), 0, 'teammate file');
  await denied(as(nabil, `insert into public.task_resources (task_id, title, resource_type, external_url) values ($1, 'x', 'article', 'https://example.com')`, [tDb]), /row-level security/);
});

await test('a resource survives later changes even after its file is gone', async () => {
  const id = (await one(service(`select id from public.task_resources where storage_path = $1`, [pdfPath]))).id;
  await service(`delete from storage.objects where bucket_id = 'task-resources' and name = $1`, [pdfPath]);
  await service(`update public.task_resources set uploaded_by = null where id = $1`, [id]);
  eq(await count(layla, `update public.task_resources set title = 'Schema template (old)' where id = $1 returning id`, [id]), 1, 'title edit');
  await service(`insert into storage.objects (bucket_id, name) values ('task-resources', $1)`, [pdfPath]);
});

// ================================================================ discussion

console.log('\nDiscussion');

let question;
let reply;

await test('the assignee asks a question and the leader replies', async () => {
  question = (await one(as(nabil, `insert into public.task_comments (task_id, kind, content) values ($1, 'question', 'Should users and roles be separate tables?') returning id, user_id`, [tDb])));
  eq(question.user_id, nabil, 'author set by the database');
  question = question.id;
  reply = (await one(as(layla, `insert into public.task_comments (task_id, parent_comment_id, content) values ($1, $2, 'Yes, with a join table.') returning id`, [tDb, question]))).id;
});

await test('replies go one level deep, carry no kind, and stay on the same task', async () => {
  await denied(as(nabil, `insert into public.task_comments (task_id, parent_comment_id, content) values ($1, $2, 'Thanks')`, [tDb, reply]), /reply to a reply/);
  await denied(as(nabil, `insert into public.task_comments (task_id, parent_comment_id, kind, content) values ($1, $2, 'question', 'x')`, [tDb, question]), /task_comments_kind/);
  await denied(as(layla, `insert into public.task_comments (task_id, parent_comment_id, content) values ($1, $2, 'x')`, [tBackend, question]), /same task/);
});

await test('only managers pin; authors edit only their own posts', async () => {
  await denied(as(nabil, `select public.set_comment_pinned($1, true)`, [question]), /manage this project/);
  const before = (await one(service(`select updated_at::text as t from public.task_comments where id = $1`, [question]))).t;
  await as(layla, `select public.set_comment_pinned($1, true)`, [question]);
  eq((await one(service(`select updated_at::text as t from public.task_comments where id = $1`, [question]))).t, before, 'pinning is not an edit');
  eq(await count(nabil, `update public.task_comments set content = 'Should users and roles be separate tables? (edited)' where id = $1 returning id`, [question]), 1, 'own');
  eq(await count(nabil, `update public.task_comments set content = 'Hacked' where id = $1 returning id`, [reply]), 0, 'other');
  await denied(as(nabil, `update public.task_comments set is_pinned = false where id = $1`, [question]), /permission denied/);
});

await test('people outside the task cannot read or write its discussion', async () => {
  eq(await count(mona, `select id from public.task_comments where task_id = $1`, [tDb]), 0, 'teammate reads');
  await denied(as(mona, `insert into public.task_comments (task_id, kind, content) values ($1, 'comment', 'Hi')`, [tDb]), /row-level security/);
});

await test('authors delete their own posts and managers can delete any', async () => {
  const stray = (await one(as(nabil, `insert into public.task_comments (task_id, kind, content) values ($1, 'comment', 'Typo post') returning id`, [tDb]))).id;
  eq(await count(mona, `delete from public.task_comments where id = $1 returning id`, [stray]), 0, 'teammate');
  eq(await count(layla, `delete from public.task_comments where id = $1 returning id`, [stray]), 1, 'leader');
});

// ================================================================ submissions and review (scenarios B and C)

console.log('\nSubmissions and review');

let dbV1;
let dbV2;

await test('only the assignee submits, with content that suits the task type', async () => {
  await denied(submitCode(mona, tDb, 'select 1;', 'sql'), /not assigned to you/);
  await denied(submitText(nabil, tDb, 'A text answer'), /code/);
  await denied(submitCode(nabil, tDb, 'select 1;', 'cobol'), /language/);
  await denied(as(nabil, `insert into public.submissions (task_id, user_id, version, submission_type, code_content, language) values ($1, $2, 1, 'code', 'x', 'sql')`, [tDb, nabil]), /permission denied/);
});

await test('the assignee submits version 1', async () => {
  dbV1 = await submitCode(nabil, tDb, 'create table users (id int);', 'sql');
  eq(dbV1.version, 1);
  eq(await status(tDb), 'submitted');
});

await test('members and outsiders cannot review', async () => {
  await denied(review(mona, dbV1.id, 'approve', null, 90), /cannot review/);
  await denied(review(omar, dbV1.id, 'approve', null, 90), /cannot review/);
});

await test('review inputs are checked: feedback for changes, a 0 to 100 score for approval', async () => {
  await denied(review(layla, dbV1.id, 'request_revision', '  '), /feedback/);
  await denied(review(layla, dbV1.id, 'request_revision', 'Add keys', 50), /no score/);
  await denied(review(layla, dbV1.id, 'approve', 'Nice'), /score/);
  await denied(review(layla, dbV1.id, 'approve', null, 101), /0 to 100/);
});

await test('the leader asks for changes with feedback and a private note, in one step', async () => {
  await review(layla, dbV1.id, 'request_revision', 'Add a primary key and a roles table.', null, 'Second time this week he forgets keys.');
  eq(await status(tDb), 'revision_required');
  eq((await one(service(`select review_status from public.submissions where id = $1`, [dbV1.id]))).review_status, 'revision_requested');
});

await test('the member sees the feedback but never the internal note', async () => {
  eq((await one(as(nabil, `select feedback, score from public.submission_reviews where submission_id = $1`, [dbV1.id]))), { feedback: 'Add a primary key and a roles table.', score: null });
  eq(await count(nabil, `select id from public.submission_internal_notes`), 0, 'notes hidden');
  eq(await count(layla, `select id from public.submission_internal_notes`), 1, 'leader sees notes');
});

await test('reviews and scores cannot be changed or forged', async () => {
  await denied(as(nabil, `update public.submission_reviews set score = 100`), /permission denied/);
  await denied(as(layla, `update public.submission_reviews set score = 100`), /permission denied/);
  await denied(as(layla, `insert into public.submission_reviews (submission_id, review_action, score) values ($1, 'approved', 100)`, [dbV1.id]), /permission denied/);
  await denied(review(layla, dbV1.id, 'approve', null, 90), /already been reviewed/);
});

await test('version 2 is approved with a score; version 1 is kept; the task completes', async () => {
  dbV2 = await submitCode(nabil, tDb, 'create table users (id int primary key);', 'sql');
  eq(dbV2.version, 2);
  await denied(submitCode(nabil, tDb, 'again', 'sql'), /waiting for review/);
  await review(layla, dbV2.id, 'approve', 'Good.', 88);
  eq(await status(tDb), 'completed');
  eq((await service(`select version, review_status from public.submissions where task_id = $1 order by version`, [tDb])),
    [{ version: 1, review_status: 'revision_requested' }, { version: 2, review_status: 'approved' }]);
  await denied(submitCode(nabil, tDb, 'v3', 'sql'), /already completed/);
});

await test('approving the prerequisite unblocks the next task', async () => {
  await as(mona, `select public.start_task($1)`, [tBackend]);
  eq(await status(tBackend), 'in_progress');
  const sub = await submitText(mona, tBackend, 'REST endpoints for users and roles.');
  await review(layla, sub.id, 'approve', null, 95);
});

await test('a file submission must point at the member\'s own upload for this task', async () => {
  const path = `${tApi}/${nabil}/abc-api.zip`;
  await as(nabil, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [path]);
  await denied(as(mona, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`${tApi}/${mona}/abc.zip`]), /row-level security/);
  await denied(submitFile(nabil, tApi, `${tApi}/${nabil}/missing.zip`, 'missing.zip'), /upload/i);
  const sub = await submitFile(nabil, tApi, path, 'api.zip');
  eq(sub.version, 1);
  eq(await count(mona, `select name from storage.objects where bucket_id = 'submissions'`), 0, 'teammate cannot read the file');
  eq(await count(layla, `select name from storage.objects where bucket_id = 'submissions'`), 1, 'leader can');
});

// ================================================================ leader reviewing own work (review focus 1)

console.log('\nNo one reviews their own work');

let monaB;

await test('a leader assigned work in their own project cannot review it or read notes on it', async () => {
  const task = await newTask(amira, projB, { title: 'Release checklist', assigned_to: mona, submission_type: 'text' });
  monaB = await submitText(mona, task, 'Checklist v1');
  await denied(review(mona, monaB.id, 'approve', null, 100), /your own work/);
  await as(amira, `select public.add_internal_note($1, 'Ask her to add rollback steps next time.')`, [monaB.id]);
  eq(await count(mona, `select id from public.submission_internal_notes where submission_id = $1`, [monaB.id]), 0, 'notes on own work hidden');
  await review(basel, monaB.id, 'approve', null, 70);
});

await test('a member cannot add internal notes', () =>
  denied(as(nabil, `select public.add_internal_note($1, 'x')`, [dbV2.id]), /cannot review/));

// ================================================================ performance (scenario D)

console.log('\nPerformance numbers');

let revisionOnly;

await test('versions do not inflate counts and revision-only work is left out of the average', async () => {
  revisionOnly = await newTask(mona, projB, { title: 'Push notifications', assigned_to: nabil, submission_type: 'text' });
  const sub = await submitText(nabil, revisionOnly, 'Draft');
  await review(mona, sub.id, 'request_revision', 'Needs a plan for iOS.');
  eq(await perf(nabil, nabil), { assigned_tasks: 3, completed_tasks: 1, average_score: 88 });
});

await test('the average uses each task\'s approved score', async () => {
  eq(await perf(mona, mona), { assigned_tasks: 2, completed_tasks: 2, average_score: 82.5 });
});

await test('leaders see numbers for their project only; members see only their own', async () => {
  eq(await perf(layla, nabil, projA), { assigned_tasks: 2, completed_tasks: 1, average_score: 88 }, 'leader, project A');
  eq(await perf(layla, nabil), { assigned_tasks: 2, completed_tasks: 1, average_score: 88 }, 'leader, no project given');
  await denied(perf(layla, nabil, projB), /cannot see/);
  await denied(perf(mona, nabil, projA), /cannot see/);
  eq(await perf(amira, nabil), { assigned_tasks: 3, completed_tasks: 1, average_score: 88 }, 'admin');
});

await test('a person with no evaluated work has no average yet', async () => {
  eq(await perf(omar, omar), { assigned_tasks: 0, completed_tasks: 0, average_score: null });
});

// ================================================================ removal

console.log('\nRemoving people');

await test('a leader removes regular members only, and never themselves', async () => {
  await denied(as(layla, `select public.remove_member($1, $2)`, [projA, layla]), /yourself/);
  await setProjectRole(amira, projA, mona, 'team_leader');
  await denied(as(layla, `select public.remove_member($1, $2)`, [projA, mona]), /Platform Admin can remove a Team Leader/);
  await setProjectRole(amira, projA, mona, 'member');
});

await test('removal unassigns open work but completed work still counts (review focus 4)', async () => {
  await as(layla, `select public.remove_member($1, $2)`, [projA, nabil]);
  eq((await one(service(`select assigned_to from public.tasks where id = $1`, [tDb]))).assigned_to, null, 'unassigned');
  eq(await perf(amira, nabil), { assigned_tasks: 1, completed_tasks: 1, average_score: 88 });
  eq(await count(nabil, `select id from public.tasks where project_id = $1`, [projA]), 0, 'access ends');
  eq(await count(nabil, `select id from public.submissions where task_id = $1`, [tDb]), 0, 'history hidden once out');
});

// ================================================================ archive and delete

console.log('\nArchive and delete');

await test('only a Platform Admin archives; an archived project is read-only for everyone', async () => {
  await denied(as(layla, `update public.projects set status = 'archived' where id = $1`, [projA]), /Only a Platform Admin/);
  eq(await count(layla, `update public.projects set description = 'Leader edit' where id = $1 returning id`, [projA]), 1, 'leader edits details');
  await as(amira, `update public.projects set status = 'archived' where id = $1`, [projA]);
  await denied(as(layla, `update public.projects set name = 'x' where id = $1`, [projA]), /archived/);
  await denied(newTask(layla, projA, { title: 'Late task' }), /row-level security/);
  await denied(invite(layla, projA, 'late@example.com'), /archived/);
  await denied(as(mona, `insert into public.task_comments (task_id, kind, content) values ($1, 'comment', 'Hi')`, [tBackend]), /row-level security/);
});

await test('a project must be archived before it is deleted; deleting removes everything', async () => {
  await denied(as(amira, `delete from public.projects where id = $1`, [projB]), /Archive/);
  eq(await count(layla, `delete from public.projects where id = $1 returning id`, [projA]), 0, 'leader cannot delete');
  eq(await count(amira, `delete from public.projects where id = $1 returning id`, [projA]), 1, 'admin deletes');
  const [left] = await service(`select (select count(*)::int from public.tasks where project_id = $1) as tasks,
    (select count(*)::int from public.task_dependencies) as deps, (select count(*)::int from public.task_resources) as resources`, [projA]);
  eq(left, { tasks: 0, deps: 0, resources: 0 });
});

// ================================================================ security sweep (scenario E)

console.log('\nSecurity sweep');

const tables = ['profiles', 'projects', 'project_members', 'invitations', 'activity_logs', 'tasks', 'task_dependencies',
  'task_resources', 'task_comments', 'submissions', 'submission_reviews', 'submission_internal_notes'];

await test('anonymous visitors can read no table and call no signed-in action', async () => {
  for (const table of tables) await denied(anon(`select 1 from public.${table}`), /permission denied/);
  await denied(anon(`select public.member_performance($1, null)`, [mona]), /permission denied/);
  await denied(anon(`select public.set_platform_role($1, 'platform_admin')`, [mona]), /permission denied/);
});

await test('a leader cannot read another project\'s records', async () => {
  eq(await count(layla, `select id from public.tasks where project_id = $1`, [projB]), 0, 'tasks');
  eq(await count(layla, `select id from public.submissions`), 0, 'submissions');
});

await test('activity is scoped: admins see all, leaders their projects, members their own', async () => {
  assert(await count(basel, `select id from public.activity_logs`) > 10, 'admin sees everything');
  const monaRows = await as(nabil, `select user_id from public.activity_logs`);
  assert(monaRows.every((r) => r.user_id === nabil), 'a member sees only their own entries');
  await denied(as(mona, `insert into public.activity_logs (action, entity_type) values ('fake', 'task')`), /permission denied/);
});

await test('overview numbers follow what each person may see', async () => {
  const admin = (await one(as(amira, `select public.overview_stats() as s`))).s;
  eq([admin.total_projects, admin.active_projects, admin.total_users], [1, 1, 7], 'admin');
  const leader = (await one(as(mona, `select public.overview_stats() as s`))).s;
  eq(leader.total_projects, 1, 'leader of B');
});

await test('a Platform Admin removes another admin\'s rights, never their own', async () => {
  await setPlatformRole(amira, basel, 'user');
  await denied(setPlatformRole(basel, amira, 'user'), /Only a Platform Admin/);
});

await test('row level security is on for every table', async () => {
  eq(await service(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`), []);
  eq((await one(service(`select count(*)::int as n from pg_tables where schemaname = 'public'`))).n, tables.length, 'table count');
});

// ---------------------------------------------------------------- summary

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed:\n' + failures.map((name) => `  - ${name}`).join('\n'));
  process.exit(1);
}
