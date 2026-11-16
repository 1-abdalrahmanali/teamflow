// member/task-details.html?id=...: read the task, do the work, submit it, see every review.
import { getTask, startTask } from '../tasks/tasks.js';
import { listVersions, submitSolution } from '../submissions/submissions.js';
import { $, html, icon, on, render, setBusy } from '../utils/dom.js';
import { deadlineInfo, fileSize, formatDateTime } from '../utils/format.js';
import { param, url } from '../utils/paths.js';
import { LANGUAGES, MAX_UPLOAD_BYTES, SUBMISSION_TYPES } from '../utils/constants.js';
import { isGithubUrl, showFormMessage } from '../utils/validate.js';
import { backLink, mountApp } from '../components/layout.js';
import { emptyState, errorState, feedbackNote, loading, priorityTag, taskStatus } from '../components/ui.js';
import { confirmDialog, openModal } from '../components/modal.js';
import { flashNext, toast, toastError } from '../components/toast.js';
import { canFormat, copyText, createEditor } from '../components/code-editor.js';
import { renderSubmissionContent } from '../components/submission-view.js';
import { versionList } from '../components/version-list.js';
import { mountComments } from '../components/comments-panel.js';
import { projectHref } from './member-shared.js';

const { profile, page, actions, setTitle } = await mountApp({ area: 'member', active: 'tasks', title: 'Task' });
const taskId = param('id');

// ---------------------------------------------------------------- drafts kept in this browser

const draftKey = `teamflow.draft.${taskId}`;
const checksKey = `teamflow.checks.${taskId}`;
const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
const clearDraft = () => {
  try {
    localStorage.removeItem(draftKey);
  } catch {
    // Nothing to clear.
  }
};

// ---------------------------------------------------------------- pieces

function requirementsList(requirements) {
  const lines = requirements.split('\n').map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean);
  if (!lines.length) return '';
  const ticked = readJson(checksKey, []);
  return html`<h4 style="margin-top:var(--s-5)">Requirements</h4>
    <p class="tiny faint">Tick them off as you go. Only you see these ticks.</p>
    <ul style="list-style:none;padding:0;margin:var(--s-2) 0 0" data-checklist>
      ${lines.map((line, index) => html`<li style="padding:4px 0"><label class="row row-top" style="gap:var(--s-2);cursor:pointer">
        <input type="checkbox" data-check="${index}" ${ticked.includes(index) ? 'checked' : ''} style="margin-top:5px">
        <span class="prewrap">${line}</span></label></li>`)}
    </ul>`;
}

function statusPanel(task, versions) {
  const latest = versions[versions.length - 1];
  const messages = {
    todo: 'Start the task when you begin, so your project owner can see it is moving.',
    in_progress: 'Submit when it meets the requirements. You can always send a new version later if changes are needed.',
    submitted: `Version ${latest?.version} is waiting for review. You will see the outcome here.`,
    revision_required: 'Your reviewer left a note. Make the changes, then submit a new version.',
    completed: 'Approved. This task is complete.',
  };
  return html`<section class="card card-pad stack-sm">
    <div class="row row-between"><h3>Status</h3>${taskStatus(task.status)}</div>
    <p class="small muted">${messages[task.status]}</p>
    ${task.status === 'todo' && task.project?.status === 'active'
      ? html`<button class="btn btn-block" type="button" data-action="start" style="margin-top:var(--s-2)">${icon('play')}Start task</button>`
      : ''}
  </section>`;
}

function workArea(task) {
  const type = task.submission_type;
  const draft = readJson(draftKey, null);
  if (type === 'code') {
    return html`<div class="editor-frame">
      <div class="editor-bar">
        <label class="row small" style="gap:6px"><span class="faint">Language</span>
          <select class="select" data-language style="min-height:32px;width:auto;padding:4px 8px">
            ${LANGUAGES.map((l) => html`<option value="${l.value}" ${(draft?.language || task.programming_language || 'javascript') === l.value ? 'selected' : ''}>${l.label}</option>`)}
          </select></label>
        <div class="row" style="gap:4px">
          <span class="tiny faint" data-draft-state aria-live="polite"></span>
          <button class="btn btn-ghost btn-sm" type="button" data-action="format">${icon('wand-sparkles')}Format</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="copy">${icon('copy')}Copy</button>
        </div>
      </div>
      <div class="editor-host" data-editor>${loading(3)}</div>
    </div>`;
  }
  if (type === 'text') {
    return html`<label class="field"><span class="sr-only">Your answer</span>
      <textarea class="textarea" data-text style="min-height:260px" maxlength="50000" placeholder="Write your answer here.">${draft?.content || ''}</textarea>
      <span class="field-hint" data-draft-state aria-live="polite"></span></label>`;
  }
  if (type === 'github_link') {
    return html`<label class="field"><span class="field-label">Repository link</span>
      <input class="input mono" data-link value="${draft?.content || ''}" placeholder="https://github.com/your-name/your-project" inputmode="url">
      <span class="field-hint">Make sure the repository is public, or that your reviewer has access to it.</span></label>`;
  }
  return html`<label class="card card-pad" style="display:block;border-style:dashed;text-align:center;cursor:pointer" data-dropzone>
      <span class="empty-icon">${icon('upload')}</span>
      <span class="strong" style="display:block" data-file-name>Choose a file, or drop it here</span>
      <span class="tiny faint" style="display:block">One file, up to ${fileSize(MAX_UPLOAD_BYTES)}.</span>
      <input type="file" class="sr-only" data-file>
    </label>`;
}

// ---------------------------------------------------------------- page

render(page, loading(8));
let task;
let versions;
try {
  task = taskId ? await getTask(taskId) : null;
  if (!task || task.assigned_to !== profile.id) throw new Error('This task does not exist, or it is not assigned to you.');
  versions = await listVersions(task.id);
} catch (error) {
  render(page, html`${backLink(url('member/tasks.html'), 'All my tasks')}${errorState(error.message)}`);
  on(page, 'click', '[data-action="reload"]', () => window.location.reload());
}

if (task) {
  const latest = versions[versions.length - 1];
  const archived = task.project?.status === 'archived';
  const canSubmit = !archived && ['todo', 'in_progress', 'revision_required'].includes(task.status);
  const due = deadlineInfo(task.deadline, task.status);
  const type = SUBMISSION_TYPES[task.submission_type];

  setTitle(task.title, task.project?.name || '');
  render(actions, html`<div class="row row-wrap">${priorityTag(task.priority)}<span class="tag ${due.tone === 'late' ? 'tag-high' : ''}">${icon('calendar-days')}${due.label}</span></div>`);

  render(
    page,
    html`${backLink(projectHref(task.project), task.project?.name || 'Project')}
    ${archived ? html`<p class="form-message is-info">This project is archived. You can read everything, but submissions are closed.</p>` : ''}
    <div class="grid-2">
      <div class="stack">
        <section class="card card-pad">
          <h3>What to do</h3>
          ${task.description ? html`<p class="prewrap" style="margin-top:var(--s-2)">${task.description}</p>` : html`<p class="muted" style="margin-top:var(--s-2)">No description. The title says it all, or ask in the discussion below.</p>`}
          ${task.requirements ? requirementsList(task.requirements) : ''}
        </section>

        ${task.status === 'revision_required' && latest?.feedback
          ? html`<div>${feedbackNote({ feedback: latest.feedback, reviewer: latest.reviewer, when: latest.reviewed_at })}</div>`
          : ''}

        <section class="card">
          <div class="card-head">
            <h3>${canSubmit ? (latest ? `Version ${latest.version + 1}` : 'Your work') : latest ? `Version ${latest.version}` : 'Your work'}</h3>
            <span class="tag">${icon(type.icon)}${type.label}</span>
          </div>
          <div class="card-body stack">
            ${canSubmit
              ? html`${workArea(task)}
                  <p class="form-message" id="submit-message" hidden></p>
                  <div class="row row-wrap row-between">
                    <span class="small faint">${latest ? `Your last version was ${latest.version}. Earlier versions are kept.` : 'Your project owner reviews it after you submit.'}</span>
                    <button class="btn" type="button" data-action="submit">${icon('send')}Submit ${latest ? `version ${latest.version + 1}` : 'for review'}</button>
                  </div>`
              : latest
                ? html`<div id="submitted-view"></div>`
                : emptyState({ iconName: 'archive', title: 'Nothing was submitted', body: 'This project closed before any work was handed in.' })}
          </div>
        </section>
      </div>

      <div class="stack">
        ${statusPanel(task, versions)}
        <section class="card">
          <div class="card-head"><h3>Your versions</h3></div>
          <div class="card-body">${versions.length
            ? versionList(versions)
            : html`<p class="small muted">Nothing submitted yet. Each submission is kept as its own version, with the review it gets.</p>`}</div>
        </section>
        <div id="comments"></div>
      </div>
    </div>`,
  );

  mountComments($('#comments'), { taskId: task.id, profile, canWrite: true });
  if (!canSubmit && latest) renderSubmissionContent($('#submitted-view'), { submission: latest, type: task.submission_type });

  // Requirement ticks are a personal checklist kept in this browser.
  on(page, 'change', '[data-check]', () => {
    writeJson(checksKey, [...page.querySelectorAll('[data-check]:checked')].map((box) => Number(box.dataset.check)));
  });

  // Earlier versions open in a dialog.
  on(page, 'click', '[data-version-id]', (event, button) => {
    const version = versions.find((v) => v.id === button.dataset.versionId);
    let release = () => {};
    openModal({
      title: `Version ${version.version}`,
      wide: true,
      body: html`<p class="small faint" style="margin-bottom:var(--s-3)">Submitted ${formatDateTime(version.submitted_at)}</p><div data-version-content></div>`,
      onMount: async (modal) => {
        release = await renderSubmissionContent($('[data-version-content]', modal), { submission: version, type: task.submission_type });
      },
    });
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.modal-scrim')) {
        release();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  });

  on(page, 'click', '[data-action="start"]', async (event, button) => {
    setBusy(button, true);
    try {
      await startTask(task.id);
      flashNext('Task started');
      window.location.reload();
    } catch (error) {
      toastError(error);
      setBusy(button, false);
    }
  });

  if (canSubmit) await setUpWorkArea(task, latest);
}

async function setUpWorkArea(task, latest) {
  const type = task.submission_type;
  const draftState = $('[data-draft-state]');
  let saveTimer;
  const saveDraft = (content, language) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (writeJson(draftKey, { content, language }) && draftState) draftState.textContent = 'Draft saved in this browser';
    }, 600);
  };

  let getContent = () => null;
  let getLanguage = () => null;
  let chosenFile = null;

  if (type === 'code') {
    const draft = readJson(draftKey, null);
    const languageSelect = $('[data-language]');
    // Start from the draft, otherwise from the last version so a revision builds on it.
    const editor = await createEditor($('[data-editor]'), {
      value: draft?.content ?? latest?.code ?? '',
      language: languageSelect.value,
    });
    const formatButton = $('[data-action="format"]');
    const syncFormat = () => {
      formatButton.disabled = editor.isFallback || !canFormat(languageSelect.value);
      formatButton.title = formatButton.disabled ? 'Formatting is not available for this language' : '';
    };
    syncFormat();
    languageSelect.addEventListener('change', () => {
      editor.setLanguage(languageSelect.value);
      syncFormat();
      saveDraft(editor.getValue(), languageSelect.value);
    });
    formatButton.addEventListener('click', () => editor.format());
    $('[data-action="copy"]').addEventListener('click', async () => toast((await copyText(editor.getValue())) ? 'Copied' : 'Copy failed'));
    // Saving the draft as they type means a closed tab never loses work.
    editor.onChange(() => saveDraft(editor.getValue(), languageSelect.value));
    getContent = () => editor.getValue();
    getLanguage = () => languageSelect.value;
  } else if (type === 'text') {
    const area = $('[data-text]');
    if (!area.value && latest?.code) area.value = latest.code;
    area.addEventListener('input', () => saveDraft(area.value, null));
    getContent = () => area.value;
  } else if (type === 'github_link') {
    const input = $('[data-link]');
    if (!input.value && latest?.code) input.value = latest.code;
    input.addEventListener('input', () => saveDraft(input.value.trim(), null));
    getContent = () => input.value.trim();
  } else {
    const zone = $('[data-dropzone]');
    const fileInput = $('[data-file]');
    const choose = (file) => {
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        toast(`That file is ${fileSize(file.size)}. The limit is ${fileSize(MAX_UPLOAD_BYTES)}.`, 'error');
        return;
      }
      chosenFile = file;
      $('[data-file-name]').textContent = `${file.name} (${fileSize(file.size)})`;
    };
    fileInput.addEventListener('change', () => choose(fileInput.files[0]));
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.style.borderColor = 'var(--indigo)';
    });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.style.borderColor = '';
      choose(event.dataTransfer.files[0]);
    });
  }

  $('[data-action="submit"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const message = $('#submit-message');
    const content = getContent();

    if (type === 'file_upload' && !chosenFile) return showFormMessage(message, 'Choose a file to upload first.');
    if (type !== 'file_upload' && !content?.trim()) return showFormMessage(message, 'There is nothing to submit yet.');
    if (type === 'github_link' && !isGithubUrl(content)) {
      return showFormMessage(message, 'Paste a link to a GitHub repository, like https://github.com/name/project.');
    }
    showFormMessage(message, '');

    const next = (latest?.version || 0) + 1;
    const ok = await confirmDialog({
      title: `Submit version ${next}?`,
      body: 'Your project owner will review it. This version cannot be changed afterwards, but you can send a new one if they ask for changes.',
      confirmLabel: `Submit version ${next}`,
    });
    if (!ok) return;

    setBusy(button, true);
    try {
      const result = await submitSolution({ task, userId: profile.id, content, language: getLanguage(), file: chosenFile });
      clearDraft();
      flashNext(`Version ${result.version} submitted`);
      window.location.reload();
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(button, false);
    }
  });
}
