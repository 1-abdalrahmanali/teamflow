// app/task.html?id=...: one task. The assignee reads the brief, opens the learning
// material, asks questions and hands in work; managers see the same page with the
// versions to review and the controls to change the task.
import { backLink, mountApp } from '../components/layout.js';
import { createEditor } from '../components/code-editor.js';
import { mountDiscussion } from '../components/discussion-panel.js';
import { openModal } from '../components/modal.js';
import { mountResources } from '../components/resources-panel.js';
import { renderSubmissionContent } from '../components/submission-view.js';
import { toast, toastError } from '../components/toast.js';
import {
  avatar,
  blockedTag,
  deadlineTag,
  emptyState,
  feedbackNote,
  priorityTag,
  scoreBadge,
  taskStatus,
  typeTag,
  withLoading,
} from '../components/ui.js';
import { versionList } from '../components/version-list.js';
import { supabase } from '../config/supabase.js';
import { listMembers } from '../members/members.js';
import { listVersions, submitSolution } from '../submissions/submissions.js';
import { listDependents, listPrerequisites } from '../tasks/dependencies.js';
import { getTask, startTask } from '../tasks/tasks.js';
import { LANGUAGES, MAX_SUBMISSION_BYTES, TASK_STATUS, languageLabel } from '../utils/constants.js';
import { $, html, icon, on, render, setBusy } from '../utils/dom.js';
import { fileSize, formatDateTime, plural } from '../utils/format.js';
import { param, url } from '../utils/paths.js';
import { deadlineInfo, formatInZone, zoneLabel } from '../utils/time.js';

const taskId = param('id');
const { access, profile, page, actions, setTitle, setActive } = await mountApp({ active: 'my-tasks', title: 'Task' });

// Small per-browser conveniences: requirement ticks and an unsent code or text draft.
const store = {
  key: (kind) => `teamflow.${kind}.${taskId}.${profile.id}`,
  get(kind, fallback) {
    try {
      const value = localStorage.getItem(this.key(kind));
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(kind, value) {
    try {
      localStorage.setItem(this.key(kind), JSON.stringify(value));
    } catch {
      // Storage unavailable: the convenience is skipped.
    }
  },
  clear(kind) {
    try {
      localStorage.removeItem(this.key(kind));
    } catch {
      // Nothing to clear.
    }
  },
};

let disposeEditor = () => {};

async function load() {
  const task = await getTask(taskId);
  if (!task) return { task: null };
  const managing = access.canManage(task.project_id);
  const [prerequisites, dependents, versions, people, admins] = await Promise.all([
    listPrerequisites(taskId),
    managing ? listDependents(taskId) : [],
    listVersions(taskId),
    listMembers(task.project_id),
    supabase.from('profiles').select('id').eq('platform_role', 'platform_admin').then((r) => r.data || []),
  ]);
  return { task, managing, prerequisites, dependents, versions, people, admins };
}

function requirementList(task) {
  const lines = String(task.requirements || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  if (!lines.length) return '';
  const ticked = new Set(store.get('checks', []));
  return html`<div class="stack-sm">
    <h3 class="sub-title">Requirements</h3>
    <ul class="requirements">${lines.map(
      (line, index) => html`<li><label class="check-row">
        <input type="checkbox" data-check="${index}" ${ticked.has(index) ? html`checked` : ''}>
        <span>${line}</span></label></li>`,
    )}</ul>
    <p class="small faint">Ticks are a private checklist for you, saved in this browser.</p>
  </div>`;
}

function prerequisitesCard(prerequisites, dependents) {
  if (!prerequisites.length && !dependents.length) return '';
  const open = prerequisites.filter((p) => p.status !== 'completed');
  return html`<section class="card card-pad stack-sm">
    <h2 class="section-title">${icon('git-merge')}Order of work</h2>
    ${prerequisites.length
      ? html`<p class="small ${open.length ? '' : 'muted'}">${open.length
          ? `This task unlocks when ${open.length === 1 ? 'this task is' : `these ${open.length} tasks are`} completed:`
          : 'Everything this task waited for is done.'}</p>
        <ul class="dep-list">${prerequisites.map(
          (p) => html`<li class="${p.status === 'completed' ? 'is-done' : ''}">
            ${icon(p.status === 'completed' ? 'circle-check' : 'circle-dashed')}
            <span class="grow">${p.title}${p.assignee_name ? html` <span class="faint small">(${p.assignee_name})</span>` : ''}</span>
            <span class="small faint">${TASK_STATUS[p.status]?.label || p.status}</span>
          </li>`,
        )}</ul>`
      : ''}
    ${dependents.length
      ? html`<p class="small muted" style="margin-top:var(--s-2)">Finishing this unlocks:</p>
        <ul class="dep-list">${dependents.map(
          (d) => html`<li>${icon('arrow-right')}<a class="grow" href="${url('app/task.html', { id: d.task_id })}">${d.task?.title || 'A task'}</a></li>`,
        )}</ul>`
      : ''}
  </section>`;
}

function detailsCard(task, zone, prerequisitesOpen) {
  const info = deadlineInfo(task.deadline, task.status, zone);
  return html`<section class="card card-pad stack-sm">
    <h2 class="section-title">Details</h2>
    <div class="kv kv-stacked">
      <span>Assigned to</span>
      <span>${task.assignee ? html`<span class="person">${avatar(task.assignee, 'sm')}<span class="person-name">${task.assignee.full_name}</span></span>` : html`<span class="faint">Nobody yet</span>`}</span>
      <span>Deadline</span>
      <span>${task.deadline
        ? html`${formatInZone(task.deadline, zone)}${info.remaining ? html`<br><span class="small ${info.tone ? `due-${info.tone}` : 'faint'}">${info.remaining}</span>` : ''}`
        : html`<span class="faint">No deadline</span>`}</span>
      <span>Handed in as</span><span>${typeTag(task.submission_type)}${task.submission_type === 'code' && task.programming_language ? html` <span class="small faint">${languageLabel(task.programming_language)}</span>` : ''}</span>
      <span>Priority</span><span>${priorityTag(task.priority)}</span>
      <span>Status</span><span>${taskStatus(task.status)}${prerequisitesOpen && task.status === 'todo' ? html` ${blockedTag()}` : ''}</span>
    </div>
  </section>`;
}

function showVersion(version) {
  openModal({
    title: `Version ${version.version}`,
    wide: true,
    body: html`<p class="small faint" style="margin-bottom:var(--s-3)">Sent ${formatDateTime(version.submitted_at)}</p><div data-content></div>`,
    onMount(modal) {
      renderSubmissionContent($('[data-content]', modal), { submission: version }).catch(toastError);
    },
  });
}

// ------------------------------------------------------------------ the assignee's work area

function workArea(task, { versions, blocked, archived }) {
  const latest = versions.at(-1);
  if (archived) {
    return html`<div class="work-state">${icon('archive')}<div><p class="strong">This project is archived</p>
      <p class="small muted">You can read everything, but it is not taking submissions.</p></div></div>`;
  }
  if (task.status === 'completed') {
    return html`<div class="work-state work-done">${icon('badge-check')}<div class="grow">
      <p class="strong">Approved${latest?.review?.score != null ? html` with a score of ${latest.review.score}` : ''}. Well done.</p>
      <p class="small muted">Version ${latest?.version} is the final one. The full history is below.</p></div>
      ${latest?.review?.score != null ? scoreBadge(latest.review.score, { large: true }) : ''}</div>`;
  }
  if (task.status === 'submitted') {
    return html`<div class="work-state work-waiting">${icon('hourglass')}<div>
      <p class="strong">Version ${latest?.version} is waiting for review</p>
      <p class="small muted">You will see the result here and on your dashboard. You can send a new version if it comes back with notes.</p></div></div>`;
  }
  if (blocked) {
    return html`<div class="work-state work-blocked">${icon('lock')}<div>
      <p class="strong">Blocked for now</p>
      <p class="small muted">You can start once the tasks listed under Order of work are completed. Read the brief and the learning material in the meantime.</p></div></div>`;
  }
  if (task.status === 'todo') {
    return html`<div class="work-state">${icon('flag')}<div class="grow">
      <p class="strong">Ready when you are</p>
      <p class="small muted">Starting tells your Team Leader you are on it.</p></div>
      <button class="btn" type="button" data-act="start">${icon('play')}Start task</button></div>`;
  }

  const revision = task.status === 'revision_required' && latest?.review;
  const intro = revision
    ? html`<div class="stack-sm">
        <p class="strong">Version ${latest.version} came back with notes. Make the changes and send version ${latest.version + 1}.</p>
        ${feedbackNote({ feedback: latest.review.feedback, reviewer: latest.review.reviewer, when: latest.review.created_at })}
      </div>`
    : '';
  const next = (latest?.version || 0) + 1;

  if (task.submission_type === 'code') {
    const language = store.get('language', null) || latest?.language || task.programming_language || 'javascript';
    return html`${intro}<form class="stack" data-submit novalidate>
      <div class="editor-frame">
        <div class="editor-bar">
          <label class="row small" style="gap:var(--s-2)"><span class="strong">Language</span>
            <select class="select select-sm" name="language">${LANGUAGES.map((l) => html`<option value="${l.value}" ${l.value === language ? html`selected` : ''}>${l.label}</option>`)}</select></label>
          <span class="small faint" data-draft-note></span>
        </div>
        <div class="editor-host editor-tall" data-editor></div>
      </div>
      <div class="row row-between row-wrap">
        <p class="small faint">Your code is saved in this browser as you type. It is shown to reviewers, never run.</p>
        <button class="btn" type="submit">${icon('send')}Submit version ${next}</button>
      </div>
    </form>`;
  }
  if (task.submission_type === 'text') {
    return html`${intro}<form class="stack" data-submit novalidate>
      <label class="field"><span class="field-label">Your answer</span>
        <textarea class="textarea" name="text" rows="12" maxlength="50000" placeholder="Write your answer here.">${store.get('draft', revision ? latest?.text_content || '' : '')}</textarea>
        <span class="field-hint" data-count></span></label>
      <div class="row" style="justify-content:flex-end"><button class="btn" type="submit">${icon('send')}Submit version ${next}</button></div>
    </form>`;
  }
  return html`${intro}<form class="stack" data-submit novalidate>
    <label class="dropzone">
      <input type="file" name="file" class="sr-only">
      ${icon('upload')}<span class="strong" data-file-name>Choose the file to hand in</span>
      <span class="small faint">One file, up to ${fileSize(MAX_SUBMISSION_BYTES)}. A .zip works for several files.</span>
    </label>
    <div class="row" style="justify-content:flex-end"><button class="btn" type="submit">${icon('send')}Submit version ${next}</button></div>
  </form>`;
}

async function wireWorkArea(container, task, versions, rerender) {
  disposeEditor();
  disposeEditor = () => {};
  on(container, 'click', '[data-act="start"]', async (event, button) => {
    setBusy(button, true);
    try {
      await startTask(task.id);
      toast('Task started');
      rerender();
    } catch (error) {
      toastError(error);
      setBusy(button, false);
    }
  });

  const form = $('[data-submit]', container);
  if (!form) return;
  const latest = versions.at(-1);
  let editor = null;

  if (task.submission_type === 'code') {
    const saved = store.get('draft', null);
    const start = saved ?? (task.status === 'revision_required' ? latest?.code_content || '' : '');
    editor = await createEditor($('[data-editor]', form), { value: start, language: form.language.value });
    disposeEditor = () => editor.dispose();
    const note = $('[data-draft-note]', form);
    if (saved) note.textContent = 'Draft restored';
    let timer;
    editor.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        store.set('draft', editor.getValue());
        note.textContent = 'Draft saved';
      }, 500);
    });
    form.language.addEventListener('change', () => {
      editor.setLanguage(form.language.value);
      store.set('language', form.language.value);
    });
  } else if (task.submission_type === 'text') {
    const count = $('[data-count]', form);
    const update = () => {
      count.textContent = `${form.text.value.length.toLocaleString()} of 50,000 characters`;
      store.set('draft', form.text.value);
    };
    form.text.addEventListener('input', update);
    update();
  } else {
    form.file.addEventListener('change', () => {
      const file = form.file.files[0];
      $('[data-file-name]', form).textContent = file ? `${file.name} (${fileSize(file.size)})` : 'Choose the file to hand in';
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('[type="submit"]', form);
    setBusy(button, true);
    try {
      const result = await submitSolution({
        task,
        userId: profile.id,
        code: editor?.getValue(),
        language: form.language?.value,
        text: form.text?.value,
        file: form.file?.files[0],
      });
      store.clear('draft');
      toast(`Version ${result.version} submitted`);
      rerender();
    } catch (error) {
      toastError(error);
      setBusy(button, false);
    }
  });
}

// ------------------------------------------------------------------ page

let shownVersions = [];
on(page, 'change', '[data-check]', () => {
  const ticked = [...page.querySelectorAll('[data-check]:checked')].map((box) => Number(box.dataset.check));
  store.set('checks', ticked);
});
on(page, 'click', '[data-version-id]', (event, button) => {
  const version = shownVersions.find((v) => v.id === button.dataset.versionId);
  if (version) showVersion(version);
});

async function draw() {
  await withLoading(page, load, async (data) => {
    const { task } = data;
    if (!task) {
      render(
        page,
        html`<section class="card">${emptyState({
          iconName: 'file-question',
          title: 'This task is not available',
          body: 'It may have been deleted, reassigned, or it belongs to a project you are not in.',
          action: html`<a class="btn btn-quiet" href="${url('app/home.html')}">Go home</a>`,
        })}</section>`,
      );
      return;
    }
    const { managing, prerequisites, dependents, versions, people, admins } = data;
    const zone = task.project?.timezone || 'UTC';
    const archived = task.project?.status === 'archived';
    const mine = task.assigned_to === profile.id;
    const blocked = prerequisites.some((p) => p.status !== 'completed');
    const pending = versions.find((v) => v.review_status === 'pending');
    setTitle(task.title, `${task.project?.name || 'Project'}${task.deadline ? `. Due ${formatInZone(task.deadline, zone, { withZone: false })}, ${zoneLabel(zone)} time` : ''}`);

    render(
      actions,
      managing
        ? html`${pending && pending.user_id !== profile.id ? html`<a class="btn" href="${url('app/review.html', { id: pending.id })}">${icon('scan-eye')}Review version ${pending.version}</a>` : ''}
            ${!archived ? html`<a class="btn btn-quiet" href="${url('app/task-form.html', { id: task.id })}">${icon('pencil')}Edit task</a>` : ''}`
        : '',
    );

    render(
      page,
      html`${backLink(url(managing ? 'app/project.html' : 'app/tasks.html', managing ? { id: task.project_id, tab: 'tasks' } : undefined), managing ? `Back to ${task.project?.name || 'the project'}` : 'My tasks')}
      <div class="task-head">
        ${taskStatus(task.status)}
        ${blocked && task.status === 'todo' ? blockedTag() : ''}
        ${deadlineTag(task, zone)}
        ${task.priority !== 'medium' ? priorityTag(task.priority) : ''}
        ${archived ? html`<span class="status">Archived project</span>` : ''}
      </div>
      <div class="task-layout">
        <div class="task-main stack-lg">
          <section class="card card-pad stack">
            <h2 class="section-title">The brief</h2>
            <p class="prewrap ${task.description ? '' : 'faint'}">${task.description || 'No description was written for this task.'}</p>
            ${requirementList(task)}
          </section>

          ${mine
            ? html`<section class="card card-pad stack" id="work"><h2 class="section-title">${icon('square-pen')}Your work</h2><div data-work class="stack"></div></section>`
            : ''}

          ${versions.length || managing
            ? html`<section class="card card-pad stack">
                <div class="row row-between"><h2 class="section-title">${icon('history')}Versions</h2>
                  <span class="small faint">${versions.length ? plural(versions.length, 'version') : ''}</span></div>
                ${versions.length
                  ? versionList(versions, { hrefFor: managing && !mine ? (v) => url('app/review.html', { id: v.id }) : null })
                  : html`<p class="small muted">${task.assigned_to ? `${task.assignee?.full_name || 'The assignee'} has not handed anything in yet.` : 'Assign the task to someone to get work back.'}</p>`}
              </section>`
            : ''}

          <section class="card card-pad" data-resources></section>
          <section class="card card-pad" data-discussion></section>
        </div>
        <aside class="task-side stack">
          ${detailsCard(task, zone, blocked)}
          ${prerequisitesCard(prerequisites, dependents)}
        </aside>
      </div>`,
    );

    shownVersions = versions;
    if (managing && !mine) setActive(`project:${task.project_id}`);

    if (mine) {
      const work = $('[data-work]', page);
      render(work, workArea(task, { versions, blocked, archived }));
      await wireWorkArea(work, task, versions, draw);
    }

    const canWrite = !archived;
    const roles = new Map(people.map((m) => [m.user_id, m.role]));
    await Promise.all([
      mountResources($('[data-resources]', page), { task, canEdit: managing && canWrite }),
      mountDiscussion($('[data-discussion]', page), {
        task,
        me: profile.id,
        canManage: managing,
        canWrite,
        roles,
        admins: new Set(admins.map((a) => a.id)),
      }),
    ]);
  });
}

await draw();
