// app/project.html?id=...&tab=...: one project. Managers (its Team Leaders and every
// Platform Admin) get the full workspace; members get an overview of their own part.
import { backLink, mountApp } from '../components/layout.js';
import { openInviteDialog, resendWithDialog } from '../components/invite-dialog.js';
import { confirmDialog } from '../components/modal.js';
import { openProjectDialog } from '../components/project-dialog.js';
import { taskRow } from '../components/task-row.js';
import { flashNext, toast, toastError } from '../components/toast.js';
import {
  avatar,
  emptyState,
  errorState,
  invitationStatus,
  loading,
  reviewStatus,
  roleTag,
  scoreBadge,
  withLoading,
} from '../components/ui.js';
import { effectiveStatus, listInvitations, revokeInvitation } from '../invitations/invitations.js';
import { listMembers, removeMember, setProjectRole } from '../members/members.js';
import { memberPerformance } from '../performance/performance.js';
import { activityHref, deleteProject, describeActivity, getProject, listActivity, updateProject } from '../projects/projects.js';
import { listSubmissions } from '../submissions/submissions.js';
import { blockedTaskIds, listTasks } from '../tasks/tasks.js';
import { forgetAccess } from '../auth/access.js';
import { $, html, icon, on, render, setBusy } from '../utils/dom.js';
import { formatDate, formatDateTime, plural, timeAgo } from '../utils/format.js';
import { go, param, url } from '../utils/paths.js';
import { formatInZone, zoneLabel } from '../utils/time.js';

const projectId = param('id');
const { access, profile, page, actions, setTitle } = await mountApp({ active: `project:${projectId}`, title: 'Project' });

const canManage = access.canManage(projectId);
const isAdmin = access.isAdmin;
const TABS = canManage
  ? [
      { key: 'overview', label: 'Overview', icon: 'layout-dashboard' },
      { key: 'tasks', label: 'Tasks', icon: 'list-checks' },
      { key: 'members', label: 'People', icon: 'users' },
      { key: 'invitations', label: 'Invitations', icon: 'mail' },
      { key: 'submissions', label: 'Submissions', icon: 'inbox' },
      { key: 'settings', label: 'Settings', icon: 'settings' },
    ]
  : [{ key: 'overview', label: 'Overview', icon: 'layout-dashboard' }];

let project = null;
let tab = TABS.some((t) => t.key === param('tab')) ? param('tab') : 'overview';

function setTab(next) {
  tab = next;
  const address = new URL(window.location.href);
  address.searchParams.set('tab', next);
  address.searchParams.delete('joined');
  history.replaceState(null, '', address);
  draw();
}

const isActive = () => project.status === 'active';

function shell() {
  return html`${backLink(url(isAdmin ? 'app/projects.html' : 'app/home.html'), isAdmin ? 'All projects' : 'Home')}
    ${project.status === 'archived'
      ? html`<div class="callout">${icon('archive')}<span>This project is archived. Everything is read-only${isAdmin ? ' until you restore it in Settings' : ''}.</span></div>`
      : ''}
    ${TABS.length > 1
      ? html`<div class="tabs" role="tablist" aria-label="Project sections">
          ${TABS.map(
            (t) => html`<button class="tab" type="button" role="tab" data-tab="${t.key}" aria-selected="${String(t.key === tab)}">${icon(t.icon)}${t.label}</button>`,
          )}
        </div>`
      : ''}
    <div id="tab-body" class="tab-body"></div>`;
}

on(page, 'click', '[data-tab]', (event, button) => setTab(button.dataset.tab));

function draw() {
  render(page, shell());
  const body = $('#tab-body');
  const views = { overview, tasks, members, invitations, submissions, settings };
  views[tab](body).catch((error) => render(body, errorState(error.message)));
}

function drawActions() {
  if (!canManage || !isActive()) {
    render(actions, '');
    return;
  }
  render(
    actions,
    html`<button class="btn btn-quiet" type="button" data-invite>${icon('user-plus')}Invite</button>
      <a class="btn" href="${url('app/task-form.html', { project: projectId })}">${icon('plus')}New task</a>`,
  );
  $('[data-invite]', actions).addEventListener('click', () =>
    openInviteDialog({ projects: [project], projectId, onCreated: () => tab === 'invitations' && draw() }),
  );
}

// ------------------------------------------------------------------ overview

async function overview(body) {
  render(body, loading(5));
  const [tasksList, people, mine] = await Promise.all([
    listTasks({ projectId }),
    listMembers(projectId),
    access.roleIn(projectId) ? memberPerformance(profile.id, projectId).catch(() => null) : null,
  ]);
  const leaders = people.filter((m) => m.role === 'team_leader');
  const about = html`<section class="card card-pad stack-sm">
    <h2 class="section-title">About this project</h2>
    <p class="prewrap ${project.description ? '' : 'faint'}">${project.description || 'No description yet.'}</p>
    <div class="kv">
      <span>Time zone</span><span>${project.timezone.replace(/_/g, ' ')}. Deadlines are shown in ${zoneLabel(project.timezone)} time.</span>
      <span>Started</span><span>${formatDate(project.created_at)}</span>
      <span>Team ${leaders.length === 1 ? 'Leader' : 'Leaders'}</span>
      <span>${leaders.length ? leaders.map((m) => m.user?.full_name).join(', ') : 'None yet'}</span>
    </div>
  </section>`;

  if (!canManage) {
    const blocked = await blockedTaskIds(tasksList.filter((t) => t.status === 'todo').map((t) => t.id));
    render(
      body,
      html`${param('joined') ? html`<div class="callout callout-good">${icon('party-popper')}<span>Welcome to <strong>${project.name}</strong>. Your tasks will appear below once they are assigned.</span></div>` : ''}
        ${mine
          ? html`<section class="metrics metrics-sm" aria-label="Your numbers in this project">
              <div class="metric"><p class="metric-label">Assigned tasks</p><p class="metric-value">${mine.assigned_tasks}</p></div>
              <div class="metric"><p class="metric-label">Completed tasks</p><p class="metric-value">${mine.completed_tasks}</p></div>
              <div class="metric"><p class="metric-label">Average score</p><p class="metric-value">${mine.average_score ?? '--'}</p></div>
            </section>`
          : ''}
        <div class="grid-2">
          <section class="card">
            <div class="card-head"><h2 class="section-title">Your tasks here</h2></div>
            ${tasksList.length
              ? html`<div>${tasksList.map((t) => taskRow(t, { blocked: blocked.has(t.id) }))}</div>`
              : emptyState({ iconName: 'coffee', title: 'No tasks for you yet', body: 'Your Team Leader will assign work here. You will see it on your dashboard too.' })}
          </section>
          <div class="stack">
            ${about}
            <section class="card card-pad">
              <h2 class="section-title">People</h2>
              <ul class="people-list">${people.map((m) => html`<li>${avatar(m.user)}<span class="grow">${m.user?.full_name || 'Former member'}</span>${m.role === 'team_leader' ? roleTag('team_leader') : ''}</li>`)}</ul>
            </section>
          </div>
        </div>`,
    );
    return;
  }

  const now = Date.now();
  const count = (status) => tasksList.filter((t) => t.status === status).length;
  const overdue = tasksList.filter((t) => t.status !== 'completed' && t.deadline && new Date(t.deadline).getTime() < now).length;
  const activity = await listActivity({ projectId, limit: 10 });
  render(
    body,
    html`<section class="stat-grid">
        <button class="stat" type="button" data-tab="tasks"><span class="stat-value">${tasksList.length}</span><span class="stat-label">Tasks</span></button>
        <button class="stat" type="button" data-tab="tasks"><span class="stat-value">${count('in_progress') + count('todo') + count('revision_required')}</span><span class="stat-label">Open</span></button>
        <button class="stat ${count('submitted') ? 'is-attention' : ''}" type="button" data-tab="submissions"><span class="stat-value">${count('submitted')}</span><span class="stat-label">Waiting for review</span></button>
        <button class="stat" type="button" data-tab="tasks"><span class="stat-value">${count('completed')}</span><span class="stat-label">Completed</span></button>
        <button class="stat ${overdue ? 'is-late' : ''}" type="button" data-tab="tasks"><span class="stat-value">${overdue}</span><span class="stat-label">Overdue</span></button>
      </section>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h2 class="section-title">Recent activity</h2></div>
          <div class="card-body">
            ${activity.length
              ? html`<ul class="feed">${activity.map((entry) => {
                  const href = activityHref(entry, url);
                  const sentence = html`<strong>${entry.actor?.full_name || 'Someone'}</strong> ${describeActivity(entry)}`;
                  return html`<li>${avatar(entry.actor || { full_name: '?' }, 'sm')}<span class="grow">${href ? html`<a class="plain-link" href="${href}">${sentence}</a>` : sentence}</span><time title="${formatDateTime(entry.created_at)}">${timeAgo(entry.created_at)}</time></li>`;
                })}</ul>`
              : html`<p class="muted small">Nothing has happened here yet.</p>`}
          </div>
        </section>
        <div class="stack">${about}</div>
      </div>`,
  );
}

// ------------------------------------------------------------------ tasks

async function tasks(body) {
  render(body, loading(6));
  const [list, people] = await Promise.all([listTasks({ projectId }), listMembers(projectId)]);
  const blocked = await blockedTaskIds(list.filter((t) => t.status === 'todo').map((t) => t.id));
  let status = 'all';
  let who = 'anyone';

  function drawList() {
    const shown = list.filter(
      (t) =>
        (status === 'all' || (status === 'open' ? t.status !== 'completed' : t.status === status)) &&
        (who === 'anyone' || (who === 'nobody' ? !t.assigned_to : t.assigned_to === who)),
    );
    render(
      $('#task-list', body),
      shown.length
        ? html`<div>${shown.map((t) => taskRow(t, { blocked: blocked.has(t.id), showAssignee: true }))}</div>`
        : emptyState({
            iconName: 'list-checks',
            title: list.length ? 'No tasks match' : 'No tasks yet',
            body: list.length ? 'Try a different filter.' : 'Create the first task, then assign it to someone on the team.',
            action: !list.length && isActive() ? html`<a class="btn" href="${url('app/task-form.html', { project: projectId })}">${icon('plus')}New task</a>` : '',
          }),
    );
  }

  render(
    body,
    html`<div class="filters">
        <label class="field field-inline"><span class="field-label">Status</span>
          <select class="select" id="filter-status">
            <option value="all">All</option><option value="open">Open</option><option value="todo">To do</option>
            <option value="in_progress">In progress</option><option value="submitted">Submitted</option>
            <option value="revision_required">Revision required</option><option value="completed">Completed</option>
          </select></label>
        <label class="field field-inline"><span class="field-label">Assignee</span>
          <select class="select" id="filter-who">
            <option value="anyone">Anyone</option><option value="nobody">Not assigned</option>
            ${people.map((m) => html`<option value="${m.user_id}">${m.user?.full_name || 'Former member'}</option>`)}
          </select></label>
      </div>
      <section class="card" id="task-list"></section>`,
  );
  $('#filter-status', body).addEventListener('change', (event) => {
    status = event.target.value;
    drawList();
  });
  $('#filter-who', body).addEventListener('change', (event) => {
    who = event.target.value;
    drawList();
  });
  drawList();
}

// ------------------------------------------------------------------ people

async function members(body) {
  render(body, loading(5));
  const people = await listMembers(projectId);
  const numbers = await Promise.all(people.map((m) => memberPerformance(m.user_id, projectId).catch(() => null)));

  render(
    body,
    html`<section class="card">
      <div class="card-head">
        <h2 class="section-title">${plural(people.length, 'person', 'people')} in this project</h2>
        ${isActive() ? html`<button class="btn btn-quiet btn-sm" type="button" data-invite-inline>${icon('user-plus')}Invite</button>` : ''}
      </div>
      ${people.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Person</th><th>Role</th><th>Assigned</th><th>Completed</th><th>Average score</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${people.map((m, i) => {
              const n = numbers[i];
              const self = m.user_id === profile.id;
              const canRemove = isActive() && !self && (isAdmin || m.role !== 'team_leader');
              return html`<tr data-user="${m.user_id}" data-name="${m.user?.full_name || ''}" data-role="${m.role}">
                <td><span class="person">${avatar(m.user)}<span class="grow"><span class="person-name">${m.user?.full_name || 'Former member'}${self ? ' (you)' : ''}</span>
                  <span class="person-meta">${m.user?.email || ''}, joined ${formatDate(m.joined_at)}</span></span></span></td>
                <td>${roleTag(m.role)}</td>
                <td>${n?.assigned_tasks ?? '--'}</td>
                <td>${n?.completed_tasks ?? '--'}</td>
                <td>${n?.average_score != null ? scoreBadge(n.average_score) : html`<span class="faint">None yet</span>`}</td>
                <td><div class="row" style="justify-content:flex-end;gap:var(--s-1)">
                  ${isAdmin && isActive()
                    ? m.role === 'team_leader'
                      ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="demote">Make member</button>`
                      : html`<button class="btn btn-ghost btn-sm" type="button" data-act="promote">${icon('crown')}Make Team Leader</button>`
                    : ''}
                  ${canRemove ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="remove">Remove</button>` : ''}
                </div></td>
              </tr>`;
            })}</tbody></table></div>`
        : emptyState({ iconName: 'users', title: 'Nobody here yet', body: 'Invite people by email. They join when they accept.' })}
    </section>
    ${!isAdmin ? html`<p class="small faint">Only a Platform Admin can make someone a Team Leader.</p>` : ''}`,
  );

  $('[data-invite-inline]', body)?.addEventListener('click', () => $('[data-invite]', actions)?.click());
  on(body, 'click', '[data-act]', async (event, button) => {
    const row = button.closest('[data-user]');
    const name = row.dataset.name || 'this person';
    const act = button.dataset.act;
    let yes;
    if (act === 'promote') {
      yes = await confirmDialog({
        title: `Make ${name} a Team Leader?`,
        body: `They will be able to create and assign tasks, invite people and review work in ${project.name}. This is recorded in the activity log.`,
        confirmLabel: 'Make Team Leader',
      });
    } else if (act === 'demote') {
      yes = await confirmDialog({
        title: `Make ${name} a member?`,
        body: `They keep their own tasks but can no longer manage ${project.name}.`,
        confirmLabel: 'Make member',
      });
    } else {
      yes = await confirmDialog({
        title: `Remove ${name} from ${project.name}?`,
        body: 'Their open tasks become unassigned. Their completed work and scores stay in the history.',
        confirmLabel: 'Remove',
        danger: true,
      });
    }
    if (!yes) return;
    setBusy(button, true);
    try {
      if (act === 'remove') await removeMember(projectId, row.dataset.user);
      else await setProjectRole(projectId, row.dataset.user, act === 'promote' ? 'team_leader' : 'member');
      toast(act === 'remove' ? `${name} removed` : act === 'promote' ? `${name} is now a Team Leader` : `${name} is now a member`);
      forgetAccess();
      draw();
    } catch (error) {
      toastError(error);
      setBusy(button, false);
    }
  });
}

// ------------------------------------------------------------------ invitations

async function invitations(body) {
  render(body, loading(4));
  const list = await listInvitations(projectId);
  render(
    body,
    html`<section class="card">
      <div class="card-head"><h2 class="section-title">Invitations</h2>
        ${isActive() ? html`<button class="btn btn-quiet btn-sm" type="button" data-invite-inline>${icon('user-plus')}Invite</button>` : ''}</div>
      ${list.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Email</th><th>Status</th><th>Invited by</th><th>Expires</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${list.map((inv) => {
              const status = effectiveStatus(inv);
              return html`<tr data-id="${inv.id}">
                <td class="strong">${inv.email}</td>
                <td>${invitationStatus(status)}</td>
                <td>${inv.inviter?.full_name || 'Someone'}<div class="small faint">${timeAgo(inv.created_at)}</div></td>
                <td class="nowrap">${status === 'pending' ? formatInZone(inv.expires_at, project.timezone, { withZone: false }) : html`<span class="faint">--</span>`}</td>
                <td><div class="row" style="justify-content:flex-end;gap:var(--s-1)">
                  ${isActive() && (status === 'pending' || status === 'expired')
                    ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="resend">${icon('send')}Send again</button>`
                    : ''}
                  ${isActive() && status === 'pending' ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="revoke">Withdraw</button>` : ''}
                </div></td>
              </tr>`;
            })}</tbody></table></div>`
        : emptyState({ iconName: 'mail', title: 'No invitations yet', body: 'Invite people by email. Each link works once, for that address, for seven days.' })}
    </section>`,
  );
  $('[data-invite-inline]', body)?.addEventListener('click', () => $('[data-invite]', actions)?.click());
  on(body, 'click', '[data-act]', async (event, button) => {
    const invitation = list.find((inv) => inv.id === button.closest('[data-id]').dataset.id);
    if (button.dataset.act === 'revoke') {
      const yes = await confirmDialog({
        title: `Withdraw the invitation for ${invitation.email}?`,
        body: 'The link stops working straight away. You can invite them again later.',
        confirmLabel: 'Withdraw',
        danger: true,
      });
      if (!yes) return;
    }
    setBusy(button, true);
    try {
      if (button.dataset.act === 'revoke') {
        await revokeInvitation(invitation.id);
        toast('Invitation withdrawn');
      } else {
        await resendWithDialog(invitation);
      }
      draw();
    } catch (error) {
      toastError(error);
      setBusy(button, false);
    }
  });
}

// ------------------------------------------------------------------ submissions

async function submissions(body) {
  render(body, loading(5));
  const projectTasks = await listTasks({ projectId });
  const list = await listSubmissions({ taskIds: projectTasks.map((t) => t.id) });
  const pending = list.filter((s) => s.review_status === 'pending');
  const rest = list.filter((s) => s.review_status !== 'pending');
  const row = (s) => html`<tr>
    <td><span class="person">${avatar(s.author)}<span class="person-name">${s.author?.full_name || 'Former member'}</span></span></td>
    <td><a class="strong" href="${url('app/review.html', { id: s.id })}">${s.task?.title || 'Task'}</a><div class="small faint">Version ${s.version}</div></td>
    <td class="nowrap" title="${formatDateTime(s.submitted_at)}">${timeAgo(s.submitted_at)}</td>
    <td>${reviewStatus(s.review_status)}</td>
    <td>${s.review?.score != null ? scoreBadge(s.review.score) : ''}</td>
    <td>${s.review_status === 'pending' && s.user_id !== profile.id
      ? html`<a class="btn btn-sm" href="${url('app/review.html', { id: s.id })}">Review</a>`
      : html`<a class="btn btn-ghost btn-sm" href="${url('app/review.html', { id: s.id })}">Open</a>`}</td>
  </tr>`;
  const table = (rows) => html`<div class="table-wrap"><table class="table">
    <thead><tr><th>From</th><th>Task</th><th>Sent</th><th>Status</th><th>Score</th><th><span class="sr-only">Open</span></th></tr></thead>
    <tbody>${rows.map(row)}</tbody></table></div>`;
  render(
    body,
    list.length
      ? html`<section class="card"><div class="card-head"><h2 class="section-title">Waiting for review (${pending.length})</h2></div>
          ${pending.length ? table(pending) : html`<p class="card-body muted small">Nothing is waiting. Nice.</p>`}</section>
          ${rest.length ? html`<section class="card"><div class="card-head"><h2 class="section-title">Reviewed</h2></div>${table(rest)}</section>` : ''}`
      : html`<section class="card">${emptyState({ iconName: 'inbox', title: 'No submissions yet', body: 'Work handed in on this project’s tasks shows up here for review.' })}</section>`,
  );
}

// ------------------------------------------------------------------ settings

async function settings(body) {
  render(
    body,
    html`<section class="card card-pad stack">
        <div class="row row-between row-wrap">
          <div><h2 class="section-title">Project details</h2><p class="small muted">Name, description and time zone.</p></div>
          <button class="btn btn-quiet" type="button" data-act="edit" ${isActive() ? '' : html`disabled`}>${icon('pencil')}Edit details</button>
        </div>
      </section>
      ${isAdmin
        ? html`<section class="card card-pad stack">
            <div class="row row-between row-wrap">
              <div><h2 class="section-title">${isActive() ? 'Archive this project' : 'Restore this project'}</h2>
                <p class="small muted">${isActive()
                  ? 'Archiving makes everything read-only. Nothing is deleted and you can restore it any time.'
                  : 'Restoring lets the team work in it again.'}</p></div>
              <button class="btn btn-quiet" type="button" data-act="${isActive() ? 'archive' : 'restore'}">${icon(isActive() ? 'archive' : 'archive-restore')}${isActive() ? 'Archive' : 'Restore'}</button>
            </div>
          </section>
          <section class="card card-pad stack danger-zone">
            <div class="row row-between row-wrap">
              <div><h2 class="section-title">Delete this project</h2>
                <p class="small muted">${isActive()
                  ? 'Archive the project first. Deleting removes its tasks, submissions and history for good.'
                  : 'This removes its tasks, submissions, reviews and history for good. It cannot be undone.'}</p></div>
              <button class="btn btn-danger" type="button" data-act="delete" ${isActive() ? html`disabled` : ''}>${icon('trash-2')}Delete project</button>
            </div>
          </section>`
        : html`<p class="small faint">Only a Platform Admin can archive or delete a project.</p>`}`,
  );
  on(body, 'click', '[data-act]', async (event, button) => {
    const act = button.dataset.act;
    if (act === 'edit') {
      openProjectDialog({ project, onSaved: (saved) => { project = { ...project, ...saved }; setTitle(project.name); draw(); } });
      return;
    }
    if (act === 'delete') {
      const yes = await confirmDialog({
        title: `Delete ${project.name} for good?`,
        body: 'Every task, submission, review and file reference in it will be deleted. This cannot be undone.',
        confirmLabel: 'Delete project',
        danger: true,
      });
      if (!yes) return;
      try {
        await deleteProject(projectId);
        forgetAccess();
        flashNext('Project deleted');
        go('app/projects.html');
      } catch (error) {
        toastError(error);
      }
      return;
    }
    if (act === 'archive') {
      const yes = await confirmDialog({
        title: `Archive ${project.name}?`,
        body: 'The team can still read everything, but nobody can change tasks, post or submit until it is restored.',
        confirmLabel: 'Archive',
      });
      if (!yes) return;
    }
    setBusy(button, true);
    try {
      project = { ...project, ...(await updateProject(projectId, { status: act === 'archive' ? 'archived' : 'active' })) };
      toast(act === 'archive' ? 'Project archived' : 'Project restored');
      drawActions();
      draw();
    } catch (error) {
      toastError(error);
      setBusy(button, false);
    }
  });
}

// ------------------------------------------------------------------ start

await withLoading(
  page,
  () => getProject(projectId),
  (found) => {
    if (!found) {
      render(
        page,
        html`<section class="card">${emptyState({
          iconName: 'folder-x',
          title: 'This project is not available',
          body: 'It may have been deleted, or you are not a member of it.',
          action: html`<a class="btn btn-quiet" href="${url('app/home.html')}">Go home</a>`,
        })}</section>`,
      );
      return;
    }
    project = found;
    setTitle(project.name, canManage ? `${project.status === 'archived' ? 'Archived. ' : ''}You manage this project.` : `You are a ${access.roleIn(projectId) === 'team_leader' ? 'Team Leader' : 'member'} here.`);
    if (param('joined')) toast(`Welcome to ${project.name}`);
    drawActions();
    draw();
  },
);
