// admin/project-details.html?id=...#tab
// The project workspace: Overview, Tasks, Members, Submissions, Settings.
import { deleteProject, describeActivity, getProject, listActivity, updateProject } from '../projects/projects.js';
import { listTasks } from '../tasks/tasks.js';
import { listMembers, removeMember } from '../members/members.js';
import { effectiveStatus, listInvitations, revokeInvitation } from '../invitations/invitations.js';
import { listSubmissions } from '../submissions/submissions.js';
import { $, formValues, html, icon, on, render, setBusy } from '../utils/dom.js';
import { formatDate, plural, timeAgo } from '../utils/format.js';
import { param, url } from '../utils/paths.js';
import { TASK_STATUS } from '../utils/constants.js';
import { showFormMessage } from '../utils/validate.js';
import { backLink, mountApp } from '../components/layout.js';
import { avatar, emptyState, errorState, loading, person } from '../components/ui.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { openInviteDialog } from '../components/invite-dialog.js';
import { submissionsTable, taskRowsTable } from './admin-shared.js';

const TABS = [
  ['overview', 'Overview'],
  ['tasks', 'Tasks'],
  ['members', 'Members'],
  ['submissions', 'Submissions'],
  ['settings', 'Settings'],
];

const { profile, page, actions, setTitle } = await mountApp({ area: 'admin', active: 'projects', title: 'Project' });
const projectId = param('id');

const state = { project: null, tasks: [], members: [], invitations: [], submissions: [] };
const currentTab = () => (TABS.some(([key]) => key === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');

async function loadAll() {
  const project = projectId ? await getProject(projectId) : null;
  if (!project || project.owner_id !== profile.id) {
    throw new Error('This project does not exist, or it belongs to someone else.');
  }
  const [tasks, members, invitations] = await Promise.all([
    listTasks({ projectId }),
    listMembers(projectId),
    listInvitations(projectId),
  ]);
  const submissions = await listSubmissions({ taskIds: tasks.map((t) => t.id) });
  Object.assign(state, { project, tasks, members: members.filter((m) => m.user_id !== profile.id), invitations, submissions });
}

function header() {
  const { project } = state;
  const archived = project.status === 'archived';
  setTitle(project.name, archived ? 'Archived. Restore it in Settings to add tasks or invite people.' : project.description || '');
  render(
    actions,
    archived
      ? ''
      : html`<button class="btn btn-quiet" type="button" data-action="invite">${icon('user-plus')}Invite someone</button>
             <a class="btn" href="${url('admin/task-form.html', { project: project.id })}">${icon('plus')}New task</a>`,
  );
}

function shell(content) {
  const tab = currentTab();
  const counts = { tasks: state.tasks.length, members: state.members.length, submissions: state.submissions.filter((s) => s.review_status === 'pending').length };
  return html`${backLink(url('admin/projects.html'), 'All projects')}
    <div class="tabs" role="tablist">
      ${TABS.map(([key, label]) => html`<a class="tab" role="tab" href="#${key}" aria-selected="${tab === key}">${label}${
        counts[key] ? html`<span class="count">${counts[key]}</span>` : ''
      }</a>`)}
    </div>
    <div id="tab-panel">${content}</div>`;
}

// ---------------------------------------------------------------- tabs

function overviewTab() {
  const byStatus = Object.keys(TASK_STATUS).map((key) => [key, state.tasks.filter((t) => t.status === key).length]);
  const done = state.tasks.filter((t) => t.status === 'completed').length;
  const percent = state.tasks.length ? Math.round((done / state.tasks.length) * 100) : 0;
  return html`<div class="grid-2">
    <div class="stack">
      <section class="card card-pad">
        <div class="row row-between"><h3>Progress</h3><span class="small faint">${done} of ${plural(state.tasks.length, 'task')} completed</span></div>
        <div class="progress" style="margin:var(--s-3) 0 var(--s-5)" role="img" aria-label="${percent}% completed"><span style="width:${percent}%"></span></div>
        <div class="stat-grid">
          ${byStatus.map(([key, n]) => html`<div class="stat"><div class="stat-value">${n}</div><div class="stat-label">${TASK_STATUS[key].label}</div></div>`)}
        </div>
      </section>
      <section class="card card-pad">
        <h3>About this project</h3>
        <p class="muted prewrap" style="margin-top:var(--s-2)">${state.project.description || 'No description yet. Add one in Settings so members know what they are joining.'}</p>
        <dl class="kv" style="margin-top:var(--s-4)">
          <dt>Created</dt><dd>${formatDate(state.project.created_at)}</dd>
          <dt>Members</dt><dd>${state.members.length}</dd>
          <dt>Waiting for review</dt><dd>${state.submissions.filter((s) => s.review_status === 'pending').length}</dd>
        </dl>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h3>Recent activity</h3></div>
      <div class="card-body" id="activity">${loading(3)}</div>
    </section>
  </div>`;
}

async function fillActivity() {
  const target = $('#activity');
  if (!target) return;
  try {
    const entries = await listActivity({ projectId, limit: 15 });
    render(
      target,
      entries.length
        ? html`<ul class="feed">${entries.map(
            (e) => html`<li>${avatar(e.actor, 'sm')}<div class="grow"><span class="strong">${e.actor?.id === profile.id ? 'You' : e.actor?.full_name || 'Someone'}</span>
              ${describeActivity(e)}</div><time datetime="${e.created_at}">${timeAgo(e.created_at)}</time></li>`,
          )}</ul>`
        : html`<p class="muted small">Nothing has happened here yet.</p>`,
    );
  } catch (error) {
    render(target, html`<p class="form-message is-error">${error.message}</p>`);
  }
}

let taskFilter = '';
function tasksTab() {
  const archived = state.project.status === 'archived';
  if (!state.tasks.length) {
    return html`<div class="card">${emptyState({
      iconName: 'list-checks',
      title: 'No tasks yet',
      body: state.members.length
        ? 'Write the first task and assign it to someone on the team.'
        : 'Invite someone first, so you have a person to assign tasks to.',
      action: archived ? '' : state.members.length
        ? html`<a class="btn" href="${url('admin/task-form.html', { project: projectId })}">${icon('plus')}New task</a>`
        : html`<button class="btn" type="button" data-action="invite">${icon('user-plus')}Invite someone</button>`,
    })}</div>`;
  }
  const shown = taskFilter ? state.tasks.filter((t) => t.status === taskFilter) : state.tasks;
  return html`<section class="card">
    <div class="card-head">
      <h3>${plural(shown.length, 'task')}</h3>
      <label class="row small"><span class="faint">Show</span>
        <select class="select" data-task-filter style="min-height:34px;width:auto">
          <option value="">All statuses</option>
          ${Object.entries(TASK_STATUS).map(([key, s]) => html`<option value="${key}" ${taskFilter === key ? 'selected' : ''}>${s.label}</option>`)}
        </select></label>
    </div>
    ${shown.length ? taskRowsTable(shown) : html`<p class="card-body muted">No tasks with that status.</p>`}
  </section>`;
}

function membersTab() {
  const archived = state.project.status === 'archived';
  const pending = state.invitations.filter((i) => effectiveStatus(i) === 'pending');
  const openTasks = (userId) => state.tasks.filter((t) => t.assigned_to === userId && t.status !== 'completed').length;
  return html`<div class="stack">
    <section class="card">
      <div class="card-head"><h3>${plural(state.members.length, 'member')}</h3>
        ${archived ? '' : html`<button class="btn btn-sm" type="button" data-action="invite">${icon('user-plus')}Invite someone</button>`}</div>
      ${state.members.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Member</th><th>Joined</th><th>Open tasks</th><th></th></tr></thead>
            <tbody>${state.members.map(
              (m) => html`<tr>
                <td data-label="Member">${person(m.user, m.user?.email)}</td>
                <td data-label="Joined">${formatDate(m.joined_at)}</td>
                <td data-label="Open tasks">${openTasks(m.user_id)}</td>
                <td class="cell-actions" data-label=""><button class="btn btn-ghost btn-sm" type="button" data-remove="${m.user_id}">${icon('user-minus')}Remove</button></td>
              </tr>`,
            )}</tbody></table></div>`
        : emptyState({ iconName: 'users', title: 'Just you so far', body: 'Invite people by email. You will get a link to send them yourself.' })}
    </section>
    ${pending.length
      ? html`<section class="card">
          <div class="card-head"><h3>Waiting to join</h3></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Email</th><th>Sent</th><th>Expires</th><th></th></tr></thead>
            <tbody>${pending.map(
              (i) => html`<tr>
                <td data-label="Email" class="strong">${i.email}</td>
                <td data-label="Sent">${timeAgo(i.created_at)}</td>
                <td data-label="Expires">${formatDate(i.expires_at)}</td>
                <td class="cell-actions" data-label=""><button class="btn btn-ghost btn-sm" type="button" data-revoke="${i.id}">Revoke</button></td>
              </tr>`,
            )}</tbody></table></div>
          <p class="card-body small faint" style="padding-top:var(--s-3)">Lost a link? Revoke the invitation and create a new one. Links are only shown once.</p>
        </section>`
      : ''}
  </div>`;
}

function submissionsTab() {
  if (!state.submissions.length) {
    return html`<div class="card">${emptyState({ iconName: 'inbox', title: 'No submissions yet', body: 'When members hand in work for this project, every version shows up here.' })}</div>`;
  }
  return html`<section class="card">${submissionsTable(state.submissions, { showProject: false })}</section>`;
}

function settingsTab() {
  const archived = state.project.status === 'archived';
  return html`<div class="stack" style="max-width:720px">
    <section class="card">
      <div class="card-head"><h3>Details</h3></div>
      <form class="card-body" id="details-form" novalidate>
        <label class="field"><span class="field-label">Project name</span>
          <input class="input" name="name" maxlength="120" required value="${state.project.name}"></label>
        <label class="field"><span class="field-label">Description</span>
          <textarea class="textarea" name="description" maxlength="2000">${state.project.description}</textarea></label>
        <p class="form-message" id="details-message" hidden style="margin-top:var(--s-4)"></p>
        <button class="btn" type="submit" style="margin-top:var(--s-5)">Save changes</button>
      </form>
    </section>
    <section class="card card-pad row row-wrap row-between">
      <div class="grow"><h3>${archived ? 'Restore this project' : 'Archive this project'}</h3>
        <p class="muted small" style="margin-top:4px">${archived
          ? 'Restoring lets you add tasks and invite people again.'
          : 'Archiving keeps everything readable but stops new tasks, invitations and submissions.'}</p></div>
      <button class="btn btn-quiet" type="button" data-action="toggle-archive">${icon(archived ? 'archive-restore' : 'archive')}${archived ? 'Restore project' : 'Archive project'}</button>
    </section>
    <section class="card card-pad row row-wrap row-between" style="border-color:#efc4bf">
      <div class="grow"><h3>Delete this project</h3>
        <p class="muted small" style="margin-top:4px">Deletes its ${plural(state.tasks.length, 'task')}, every submission and comment, and all invitations. This cannot be undone.</p></div>
      <button class="btn btn-danger" type="button" data-action="delete">${icon('trash-2')}Delete project</button>
    </section>
  </div>`;
}

// ---------------------------------------------------------------- drawing and events

const panels = { overview: overviewTab, tasks: tasksTab, members: membersTab, submissions: submissionsTab, settings: settingsTab };

function draw() {
  header();
  render(page, shell(panels[currentTab()]()));
  if (currentTab() === 'overview') fillActivity();
}

async function reload() {
  await loadAll();
  draw();
}

window.addEventListener('hashchange', draw);

on(document, 'click', '[data-action="invite"]', () =>
  openInviteDialog({ projects: [state.project], projectId, onCreated: () => reload().catch(toastError) }),
);

on(page, 'change', '[data-task-filter]', (event, select) => {
  taskFilter = select.value;
  draw();
});

on(page, 'click', '[data-remove]', async (event, button) => {
  const member = state.members.find((m) => m.user_id === button.dataset.remove);
  const open = state.tasks.filter((t) => t.assigned_to === member.user_id && t.status !== 'completed').length;
  const ok = await confirmDialog({
    title: `Remove ${member.user?.full_name}?`,
    body: `They lose access to ${state.project.name} straight away. ${open ? `Their ${plural(open, 'open task')} will become unassigned. ` : ''}Everything they already submitted stays in the history.`,
    confirmLabel: 'Remove member',
    danger: true,
  });
  if (!ok) return;
  try {
    await removeMember(projectId, member.user_id);
    toast(`${member.user?.full_name} removed`);
    await reload();
  } catch (error) {
    toastError(error);
  }
});

on(page, 'click', '[data-revoke]', async (event, button) => {
  const invitation = state.invitations.find((i) => i.id === button.dataset.revoke);
  const ok = await confirmDialog({
    title: 'Revoke this invitation?',
    body: `The link sent to ${invitation.email} will stop working. You can invite them again afterwards.`,
    confirmLabel: 'Revoke invitation',
    danger: true,
  });
  if (!ok) return;
  try {
    await revokeInvitation(invitation.id);
    toast('Invitation revoked');
    await reload();
  } catch (error) {
    toastError(error);
  }
});

on(page, 'submit', '#details-form', async (event, form) => {
  event.preventDefault();
  const values = formValues(form);
  const message = $('#details-message');
  if (!values.name) return showFormMessage(message, 'The project needs a name.');
  const button = $('[type="submit"]', form);
  setBusy(button, true);
  try {
    state.project = { ...state.project, ...(await updateProject(projectId, { name: values.name, description: values.description })) };
    toast('Changes saved');
    draw();
  } catch (error) {
    showFormMessage(message, error.message);
    setBusy(button, false);
  }
});

on(page, 'click', '[data-action="toggle-archive"]', async (event, button) => {
  const archiving = state.project.status === 'active';
  if (archiving) {
    const ok = await confirmDialog({
      title: 'Archive this project?',
      body: 'Members can still read their tasks, but nobody can submit, and you cannot add tasks or invite people until you restore it.',
      confirmLabel: 'Archive project',
    });
    if (!ok) return;
  }
  setBusy(button, true);
  try {
    state.project = { ...state.project, ...(await updateProject(projectId, { status: archiving ? 'archived' : 'active' })) };
    toast(archiving ? 'Project archived' : 'Project restored');
    draw();
  } catch (error) {
    toastError(error);
    setBusy(button, false);
  }
});

on(page, 'click', '[data-action="delete"]', async () => {
  const ok = await confirmDialog({
    title: `Delete ${state.project.name}?`,
    body: `This removes the project with its ${plural(state.tasks.length, 'task')}, ${plural(state.submissions.length, 'submission')}, comments and invitations. It cannot be undone.`,
    confirmLabel: 'Delete for good',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteProject(projectId);
    window.location.replace(url('admin/projects.html'));
  } catch (error) {
    toastError(error);
  }
});

render(page, loading(6));
try {
  await loadAll();
  draw();
} catch (error) {
  setTitle('Project');
  render(page, html`${backLink(url('admin/projects.html'), 'All projects')}${errorState(error.message)}`);
  on(page, 'click', '[data-action="reload"]', () => window.location.reload());
}
