// app/task-form.html?project=... (new) or ?id=... (edit). Managers only; the database
// refuses anyone else. The deadline is typed in the project's time zone.
import { backLink, mountApp } from '../components/layout.js';
import { confirmDialog } from '../components/modal.js';
import { flashNext, toastError } from '../components/toast.js';
import { emptyState, withLoading } from '../components/ui.js';
import { listMembers } from '../members/members.js';
import { getProject } from '../projects/projects.js';
import { listSubmissions } from '../submissions/submissions.js';
import { addDependency, removeDependency } from '../tasks/dependencies.js';
import { createTask, deleteTask, getTask, listTasks, updateTask } from '../tasks/tasks.js';
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';
import { LANGUAGES, PRIORITY, SUBMISSION_TYPES, TASK_STATUS } from '../utils/constants.js';
import { $, $$, formValues, html, icon, render, setBusy } from '../utils/dom.js';
import { go, param, url } from '../utils/paths.js';
import { utcToZonedInput, zoneLabel, zonedToUtc } from '../utils/time.js';
import { showFormMessage } from '../utils/validate.js';

let taskId = param('id');
const { access, page, setTitle, setActive } = await mountApp({ active: 'projects', title: taskId ? 'Edit task' : 'New task', need: 'manager' });

async function load() {
  const task = taskId ? await getTask(taskId) : null;
  const projectId = task?.project_id || param('project');
  if (!projectId) return { missing: true };
  const [project, people, siblings, deps, versions] = await Promise.all([
    getProject(projectId),
    listMembers(projectId),
    listTasks({ projectId }),
    taskId
      ? supabase.from('task_dependencies').select('depends_on_task_id').eq('task_id', taskId).then(unwrap)
      : [],
    taskId ? listSubmissions({ taskId, limit: 1 }) : [],
  ]);
  return { task, project, people, siblings: siblings.filter((t) => t.id !== taskId), deps: new Set(deps.map((d) => d.depends_on_task_id)), hasVersions: versions.length > 0 };
}

const options = (map, selected) =>
  Object.entries(map).map(([key, item]) => html`<option value="${key}" ${key === selected ? html`selected` : ''}>${item.label}</option>`);

await withLoading(page, load, (data) => {
  if (data.missing || !data.project || (taskId && !data.task) || !access.canManage(data.project?.id)) {
    render(
      page,
      html`<section class="card">${emptyState({
        iconName: 'file-question',
        title: 'This task cannot be edited here',
        body: 'It may have been deleted, or you do not manage its project.',
        action: html`<a class="btn btn-quiet" href="${url('app/home.html')}">Go home</a>`,
      })}</section>`,
    );
    return;
  }
  const { task, project, people, siblings, deps, hasVersions } = data;
  const zone = project.timezone;
  const archived = project.status === 'archived';
  setTitle(task ? 'Edit task' : 'New task', `${task ? `${task.title}, in ` : ''}${project.name}. Deadlines are in ${zoneLabel(zone)} time.`);
  setActive(`project:${project.id}`);

  render(
    page,
    html`${backLink(task ? url('app/task.html', { id: task.id }) : url('app/project.html', { id: project.id, tab: 'tasks' }), task ? 'Back to the task' : `Back to ${project.name}`)}
    ${archived ? html`<div class="callout">${icon('archive')}<span>This project is archived, so its tasks cannot be changed.</span></div>` : ''}
    <form class="card card-pad form-grid" id="task-form" novalidate>
      <div class="form-main">
        <label class="field">
          <span class="field-label">Title</span>
          <input class="input" name="title" maxlength="200" required autofocus value="${task?.title || ''}" placeholder="Build the login page">
        </label>
        <label class="field">
          <span class="field-label">What needs doing</span>
          <textarea class="textarea" name="description" rows="5" maxlength="10000"
            placeholder="The goal, the context and anything they should know first.">${task?.description || ''}</textarea>
        </label>
        <label class="field">
          <span class="field-label">Requirements <span class="faint">(optional)</span></span>
          <textarea class="textarea" name="requirements" rows="5" maxlength="10000"
            placeholder="One per line. For example: The form works with the keyboard alone.">${task?.requirements || ''}</textarea>
          <span class="field-hint">Each line becomes a checklist item the member can tick off while working.</span>
        </label>

        <fieldset class="field">
          <legend class="field-label">Must finish first <span class="faint">(optional)</span></legend>
          ${siblings.length
            ? html`<div class="check-list">${siblings.map(
                (t) => html`<label class="check-row">
                  <input type="checkbox" name="deps" value="${t.id}" ${deps.has(t.id) ? html`checked` : ''}>
                  <span class="grow">${t.title}</span>
                  <span class="small faint">${TASK_STATUS[t.status].label}</span>
                </label>`,
              )}</div>
              <span class="field-hint">This task stays blocked until every task ticked here is completed. Loops are refused.</span>`
            : html`<p class="small faint">Other tasks in this project will show here, so you can say which ones must be done first.</p>`}
        </fieldset>
      </div>

      <div class="form-side">
        <label class="field">
          <span class="field-label">Assigned to</span>
          <select class="select" name="assigned_to">
            <option value="">Nobody yet</option>
            ${!task ? html`<option value="__everyone__">Everyone in the project (one task each)</option>` : ''}
            ${people.map((m) => html`<option value="${m.user_id}" ${m.user_id === task?.assigned_to ? html`selected` : ''}>${m.user?.full_name || 'Former member'}${m.role === 'team_leader' ? ' (Team Leader)' : ''}</option>`)}
          </select>
          ${task && ['submitted', 'completed'].includes(task.status)
            ? html`<span class="field-hint">${task.status === 'completed' ? 'Completed work keeps its assignee.' : 'Review the waiting submission before reassigning.'}</span>`
            : ''}
        </label>
        <label class="field">
          <span class="field-label">Deadline <span class="faint">(optional)</span></span>
          <input class="input" type="datetime-local" name="deadline" value="${utcToZonedInput(task?.deadline, zone)}">
          <span class="field-hint">In ${zoneLabel(zone)} time, wherever you are now.</span>
        </label>
        <label class="field">
          <span class="field-label">Priority</span>
          <select class="select" name="priority">${options(PRIORITY, task?.priority || 'medium')}</select>
        </label>
        <label class="field">
          <span class="field-label">Handed in as</span>
          <select class="select" name="submission_type" ${hasVersions ? html`disabled` : ''}>${options(SUBMISSION_TYPES, task?.submission_type || 'code')}</select>
          <span class="field-hint">${hasVersions ? 'Locked, because work has already been submitted.' : 'Code in the editor, a written answer, or one file.'}</span>
        </label>
        <label class="field" data-language>
          <span class="field-label">Language</span>
          <select class="select" name="programming_language">
            ${LANGUAGES.map((l) => html`<option value="${l.value}" ${l.value === (task?.programming_language || 'javascript') ? html`selected` : ''}>${l.label}</option>`)}
          </select>
        </label>
      </div>

      <div class="form-foot">
        <p class="form-message" id="form-message" hidden></p>
        <div class="row row-wrap row-between">
          ${task ? html`<button class="btn btn-ghost btn-danger-text" type="button" id="delete-task" ${archived ? html`disabled` : ''}>${icon('trash-2')}Delete task</button>` : html`<span></span>`}
          <div class="row">
            <a class="btn btn-quiet" href="${task ? url('app/task.html', { id: task.id }) : url('app/project.html', { id: project.id, tab: 'tasks' })}">Cancel</a>
            <button class="btn" type="submit" ${archived ? html`disabled` : ''}>${task ? 'Save changes' : 'Create task'}</button>
          </div>
        </div>
      </div>
    </form>`,
  );

  const form = $('#task-form');
  const message = $('#form-message');
  const syncLanguage = () => {
    $('[data-language]', form).hidden = form.submission_type.value !== 'code';
  };
  syncLanguage();
  form.submission_type.addEventListener('change', syncLanguage);

  $('#delete-task')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: `Delete ${task.title}?`,
      body: hasVersions
        ? 'Its submissions, reviews, discussion and resources are deleted too. This cannot be undone.'
        : 'Its discussion and resources are deleted too. This cannot be undone.',
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (!yes) return;
    try {
      await deleteTask(task.id);
      flashNext('Task deleted');
      go('app/project.html', { id: project.id, tab: 'tasks' });
    } catch (error) {
      toastError(error);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    if (!values.title) {
      showFormMessage(message, 'Give the task a title.');
      form.title.focus();
      return;
    }
    let deadline = null;
    if (values.deadline) {
      const instant = zonedToUtc(values.deadline, zone);
      if (!instant) return showFormMessage(message, 'Enter the deadline as a date and a time.');
      deadline = instant.toISOString();
    }
    const type = hasVersions ? task.submission_type : values.submission_type;
    const fields = {
      title: values.title,
      description: values.description,
      requirements: values.requirements,
      assigned_to: values.assigned_to || null,
      priority: values.priority,
      deadline,
      programming_language: type === 'code' ? values.programming_language : null,
    };
    if (!hasVersions) fields.submission_type = type;

    const button = $('[type="submit"]', form);

    // "Everyone": one copy of the task for each member, with the same prerequisites.
    if (values.assigned_to === '__everyone__') {
      const members = people.filter((m) => m.role === 'member');
      if (!members.length) return showFormMessage(message, 'There are no members in this project yet. Invite people first.');
      const wanted = $$('input[name="deps"]:checked', form).map((box) => box.value);
      setBusy(button, true);
      try {
        for (const m of members) {
          const saved = await createTask({ ...fields, assigned_to: m.user_id, project_id: project.id });
          for (const id of wanted) await addDependency(saved.id, id);
        }
        flashNext(`Task created for ${members.length} ${members.length === 1 ? 'person' : 'people'}`);
        go('app/project.html', { id: project.id, tab: 'tasks' });
      } catch (error) {
        showFormMessage(message, error.message);
        setBusy(button, false);
      }
      return;
    }

    setBusy(button, true);
    showFormMessage(message, '');
    try {
      const saved = taskId ? await updateTask(taskId, fields) : await createTask({ ...fields, project_id: project.id });
      const created = !taskId;
      taskId = saved.id;
      if (created) history.replaceState(null, '', url('app/task-form.html', { id: saved.id }));

      const wanted = new Set($$('input[name="deps"]:checked', form).map((box) => box.value));
      const problems = [];
      for (const id of wanted) {
        if (!deps.has(id)) {
          try {
            await addDependency(saved.id, id);
            deps.add(id);
          } catch (error) {
            problems.push(`${siblings.find((t) => t.id === id)?.title}: ${error.message}`);
          }
        }
      }
      for (const id of [...deps]) {
        if (!wanted.has(id)) {
          try {
            await removeDependency(saved.id, id);
            deps.delete(id);
          } catch (error) {
            problems.push(`${siblings.find((t) => t.id === id)?.title}: ${error.message}`);
          }
        }
      }
      if (problems.length) {
        showFormMessage(message, `The task is saved, but some prerequisites were not changed. ${problems.join(' ')}`);
        $$('input[name="deps"]', form).forEach((box) => { box.checked = deps.has(box.value); });
        setBusy(button, false);
        button.textContent = 'Save changes';
        return;
      }
      flashNext(created ? 'Task created. Add learning material below if it helps.' : 'Task saved');
      go('app/task.html', { id: saved.id });
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(button, false);
    }
  });
});
