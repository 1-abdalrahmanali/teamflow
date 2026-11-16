// admin/task-form.html?project=ID (new task) or ?id=TASK_ID (edit a task, see its versions and discussion).
import { getProject } from '../projects/projects.js';
import { createTask, deleteTask, getTask, updateTask } from '../tasks/tasks.js';
import { listMembers } from '../members/members.js';
import { listVersions } from '../submissions/submissions.js';
import { $, formValues, html, icon, on, render, setBusy } from '../utils/dom.js';
import { toLocalInput } from '../utils/format.js';
import { param, url } from '../utils/paths.js';
import { LANGUAGES, PRIORITY, SUBMISSION_TYPES } from '../utils/constants.js';
import { showFormMessage } from '../utils/validate.js';
import { backLink, mountApp } from '../components/layout.js';
import { emptyState, errorState, loading, taskStatus } from '../components/ui.js';
import { confirmDialog } from '../components/modal.js';
import { flashNext, toastError } from '../components/toast.js';
import { mountComments } from '../components/comments-panel.js';
import { versionList } from '../components/version-list.js';
import { projectHref } from './admin-shared.js';

const { profile, page, setTitle } = await mountApp({ area: 'admin', active: 'projects', title: 'Task' });
const taskId = param('id');

async function load() {
  const task = taskId ? await getTask(taskId) : null;
  if (taskId && !task) throw new Error('This task does not exist, or it is not in one of your projects.');
  const project = await getProject(task?.project_id || param('project'));
  if (!project || project.owner_id !== profile.id) throw new Error('This project does not exist, or it belongs to someone else.');
  const [members, versions] = await Promise.all([
    listMembers(project.id),
    task ? listVersions(task.id) : Promise.resolve([]),
  ]);
  return { task, project, members: members.filter((m) => m.user_id !== profile.id), versions };
}

function typeChoice(value, current) {
  const type = SUBMISSION_TYPES[value];
  return html`<label class="card card-pad row" style="padding:var(--s-3);cursor:pointer;align-items:flex-start;gap:var(--s-2)">
    <input type="radio" name="submission_type" value="${value}" ${current === value ? 'checked' : ''} style="margin-top:4px">
    <span><span class="strong row" style="gap:6px">${icon(type.icon)}${type.label}</span><span class="tiny faint">${type.hint}</span></span>
  </label>`;
}

function form({ task, project, members }) {
  const assignable = members.length > 0;
  const type = task?.submission_type || 'code';
  const locked = task && task.status === 'submitted';
  return html`<form id="task-form" class="card" novalidate>
    <div class="card-body stack">
      <label class="field"><span class="field-label">Title</span>
        <input class="input" name="title" maxlength="200" required autofocus value="${task?.title || ''}" placeholder="Build the login page"></label>
      <label class="field"><span class="field-label">Description</span>
        <textarea class="textarea" name="description" maxlength="10000" placeholder="What is this task, and why does it matter?">${task?.description || ''}</textarea></label>
      <label class="field"><span class="field-label">Requirements</span>
        <textarea class="textarea" name="requirements" maxlength="10000" placeholder="One per line, so the member can check them off as they go.">${task?.requirements || ''}</textarea>
        <span class="field-hint">Be specific: the member reviews this list before every submission.</span></label>

      <div class="field-grid">
        <label class="field"><span class="field-label">Assign to</span>
          <select class="select" name="assigned_to" ${assignable ? '' : 'disabled'} ${locked ? 'disabled' : ''}>
            ${assignable ? '' : html`<option>Invite someone first</option>`}
            ${task && !task.assigned_to ? html`<option value="" selected>Nobody (choose someone)</option>` : ''}
            ${members.map((m) => html`<option value="${m.user_id}" ${task?.assigned_to === m.user_id ? 'selected' : ''}>${m.user?.full_name} (${m.user?.email})</option>`)}
          </select>
          ${locked ? html`<span class="field-hint">Review the waiting submission before reassigning.</span>`
            : task && task.status !== 'todo' && task.status !== 'completed' ? html`<span class="field-hint">Reassigning sends the task back to To do.</span>` : ''}
        </label>
        <label class="field"><span class="field-label">Deadline <span class="faint">(optional)</span></span>
          <input class="input" type="datetime-local" name="deadline" value="${toLocalInput(task?.deadline)}"></label>
      </div>

      <fieldset class="field" style="border:0;padding:0;margin:var(--s-4) 0 0">
        <legend class="field-label">Priority</legend>
        <div class="row">${Object.entries(PRIORITY).map(([key, p]) => html`<label class="row small" style="gap:6px">
          <input type="radio" name="priority" value="${key}" ${(task?.priority || 'medium') === key ? 'checked' : ''}>${p.label}</label>`)}</div>
      </fieldset>

      <fieldset class="field" style="border:0;padding:0;margin:var(--s-4) 0 0">
        <legend class="field-label">How should it be handed in?</legend>
        <div class="field-grid">${Object.keys(SUBMISSION_TYPES).map((key) => typeChoice(key, type))}</div>
      </fieldset>

      <label class="field" data-language ${type === 'code' ? '' : 'hidden'}><span class="field-label">Programming language</span>
        <select class="select" name="programming_language">
          ${LANGUAGES.map((l) => html`<option value="${l.value}" ${(task?.programming_language || 'javascript') === l.value ? 'selected' : ''}>${l.label}</option>`)}
        </select>
        <span class="field-hint">The editor opens in this language. The member can switch if needed.</span></label>

      <p class="form-message" id="form-message" hidden></p>
    </div>
    <div class="card-head" style="border-top:1px solid var(--line);border-bottom:0">
      ${task ? html`<button class="btn btn-ghost" type="button" data-action="delete">${icon('trash-2')}Delete task</button>` : html`<span></span>`}
      <div class="row">
        <a class="btn btn-quiet" href="${projectHref(project, 'tasks')}">Cancel</a>
        <button class="btn" type="submit" ${assignable ? '' : 'disabled'}>${task ? 'Save changes' : 'Create task'}</button>
      </div>
    </div>
  </form>`;
}

function sidePanel({ task, versions }) {
  if (!task) {
    return html`<section class="card card-pad">
      <h3>How tasks move</h3>
      <p class="muted small" style="margin-top:var(--s-2)">The member starts the task and submits their work. You review each version and either approve it or ask for changes. Only your approval completes it.</p>
    </section>`;
  }
  const pending = versions.find((v) => v.review_status === 'pending');
  return html`<div class="stack">
    <section class="card card-pad">
      <div class="row row-between"><h3>Status</h3>${taskStatus(task.status)}</div>
      ${pending ? html`<a class="btn btn-block" style="margin-top:var(--s-4)" href="${url('admin/submission-review.html', { id: pending.id })}">Review version ${pending.version}</a>` : ''}
    </section>
    <section class="card">
      <div class="card-head"><h3>Versions</h3></div>
      <div class="card-body">${versions.length
        ? versionList(versions, { hrefFor: (v) => url('admin/submission-review.html', { id: v.id }) })
        : emptyState({ iconName: 'history', title: 'Nothing submitted yet', body: 'Each submission is kept here as its own version.' })}</div>
    </section>
    <div id="comments"></div>
  </div>`;
}

render(page, loading(6));
let data;
try {
  data = await load();
} catch (error) {
  render(page, errorState(error.message));
  on(page, 'click', '[data-action="reload"]', () => window.location.reload());
}

if (data) {
  const { task, project } = data;
  setTitle(task ? task.title : 'New task', project.name);
  render(
    page,
    html`${backLink(projectHref(project, 'tasks'), `Back to ${project.name}`)}
      ${project.status === 'archived' && !task
        ? html`<div class="card">${emptyState({ iconName: 'archive', title: 'This project is archived', body: 'Restore it in the project settings to add tasks.' })}</div>`
        : html`<div class="grid-2">${form(data)}${sidePanel(data)}</div>`}`,
  );
  if (task) mountComments($('#comments'), { taskId: task.id, profile });

  const taskForm = $('#task-form');
  taskForm?.addEventListener('change', (event) => {
    if (event.target.name === 'submission_type') $('[data-language]').hidden = event.target.value !== 'code';
  });

  taskForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(taskForm);
    const message = $('#form-message');
    if (!values.title) return showFormMessage(message, 'Give the task a title.');
    const assignSelect = taskForm.assigned_to;
    if (!assignSelect.disabled && !values.assigned_to) return showFormMessage(message, 'Choose who will do this task.');

    const payload = {
      title: values.title,
      description: values.description || '',
      requirements: values.requirements || '',
      priority: values.priority,
      deadline: values.deadline ? new Date(values.deadline).toISOString() : null,
      submission_type: values.submission_type,
      programming_language: values.submission_type === 'code' ? values.programming_language : null,
    };
    // A disabled select is not part of the form data; leave the assignment as it is.
    if (!assignSelect.disabled) payload.assigned_to = values.assigned_to;

    const button = $('[type="submit"]', taskForm);
    setBusy(button, true);
    try {
      if (task) {
        await updateTask(task.id, payload);
        flashNext('Changes saved');
        window.location.replace(url('admin/task-form.html', { id: task.id }));
      } else {
        await createTask({ ...payload, project_id: project.id });
        flashNext('Task created');
        window.location.assign(projectHref(project, 'tasks'));
      }
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(button, false);
    }
  });

  on(page, 'click', '[data-action="delete"]', async () => {
    const ok = await confirmDialog({
      title: `Delete "${task.title}"?`,
      body: `This also deletes its ${data.versions.length} submitted version(s) and its discussion. It cannot be undone.`,
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTask(task.id);
      window.location.replace(projectHref(project, 'tasks'));
    } catch (error) {
      toastError(error);
    }
  });
}
