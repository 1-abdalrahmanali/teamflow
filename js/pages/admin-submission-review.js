// admin/submission-review.html?id=...: read one version, then approve it or ask for changes.
import { getSubmission, listVersions, reviewSubmission } from '../submissions/submissions.js';
import { getTask } from '../tasks/tasks.js';
import { $, html, icon, on, render, setBusy } from '../utils/dom.js';
import { formatDateTime, timeAgo } from '../utils/format.js';
import { param, url } from '../utils/paths.js';
import { SUBMISSION_TYPES } from '../utils/constants.js';
import { showFormMessage } from '../utils/validate.js';
import { backLink, mountApp } from '../components/layout.js';
import { errorState, feedbackNote, loading, person, priorityTag, reviewStatus } from '../components/ui.js';
import { flashNext } from '../components/toast.js';
import { renderSubmissionContent } from '../components/submission-view.js';
import { versionList } from '../components/version-list.js';
import { mountComments } from '../components/comments-panel.js';
import { projectHref } from './admin-shared.js';

const { profile, page, setTitle } = await mountApp({ area: 'admin', active: 'submissions', title: 'Review' });
const submissionId = param('id');

async function load() {
  const submission = submissionId ? await getSubmission(submissionId) : null;
  if (!submission || submission.task?.project?.owner_id !== profile.id) {
    throw new Error('This submission does not exist, or it is not in one of your projects.');
  }
  const [task, versions] = await Promise.all([getTask(submission.task_id), listVersions(submission.task_id)]);
  return { submission, task, versions };
}

function reviewPanel(submission) {
  if (submission.review_status !== 'pending') {
    return html`<section class="card card-pad stack-sm">
      <div class="row row-between"><h3>Your review</h3>${reviewStatus(submission.review_status)}</div>
      <p class="small faint">Reviewed ${formatDateTime(submission.reviewed_at)}</p>
      ${submission.feedback
        ? feedbackNote({ feedback: submission.feedback, reviewer: submission.reviewer, when: submission.reviewed_at })
        : html`<p class="muted small">Approved without a note.</p>`}
    </section>`;
  }
  return html`<form class="card card-pad stack" id="review-form" novalidate>
    <div><h3>Your review</h3>
      <p class="small muted" style="margin-top:4px">Approving completes the task. Asking for changes sends it back with your note.</p></div>
    <label class="field"><span class="field-label">Note to ${submission.author?.full_name?.split(' ')[0] || 'the member'}</span>
      <textarea class="textarea" name="feedback" maxlength="5000" placeholder="What works, and what should change? Required when you ask for changes."></textarea></label>
    <p class="form-message" id="review-message" hidden></p>
    <div class="row row-wrap">
      <button class="btn btn-quiet grow" type="button" data-decision="request_revision">${icon('rotate-ccw')}Ask for changes</button>
      <button class="btn btn-good grow" type="button" data-decision="approve">${icon('check')}Approve</button>
    </div>
  </form>`;
}

render(page, loading(6));
let data;
try {
  data = await load();
} catch (error) {
  render(page, html`${backLink(url('admin/submissions.html'), 'All submissions')}${errorState(error.message)}`);
  on(page, 'click', '[data-action="reload"]', () => window.location.reload());
}

if (data) {
  const { submission, task, versions } = data;
  const latest = versions[versions.length - 1];
  const type = task.submission_type;
  setTitle(task.title, `${task.project?.name}, version ${submission.version} of ${versions.length}`);

  render(
    page,
    html`${backLink(url('admin/submissions.html'), 'All submissions')}
    ${submission.id !== latest?.id
      ? html`<p class="form-message is-info">You are looking at an older version. <a href="${url('admin/submission-review.html', { id: latest.id })}">Open version ${latest.version}, the latest</a>.</p>`
      : ''}
    <div class="grid-2">
      <div class="stack">
        <section class="card card-pad row row-wrap row-between">
          ${person(submission.author, `Submitted ${timeAgo(submission.submitted_at)}, ${formatDateTime(submission.submitted_at)}`)}
          <div class="row row-wrap">${priorityTag(task.priority)}<span class="tag">${icon(SUBMISSION_TYPES[type].icon)}${SUBMISSION_TYPES[type].label}</span></div>
        </section>
        <div id="content"></div>
        <details class="card">
          <summary class="card-head" style="cursor:pointer;border-bottom:0"><h3>What the task asked for</h3></summary>
          <div class="card-body" style="border-top:1px solid var(--line)">
            ${task.description ? html`<p class="prewrap">${task.description}</p>` : ''}
            ${task.requirements ? html`<h4 style="margin-top:var(--s-4)">Requirements</h4><p class="prewrap muted">${task.requirements}</p>` : ''}
            ${!task.description && !task.requirements ? html`<p class="muted">No description was written for this task.</p>` : ''}
            <a class="btn btn-quiet btn-sm" style="margin-top:var(--s-4)" href="${url('admin/task-form.html', { id: task.id })}">Open the task</a>
          </div>
        </details>
      </div>
      <div class="stack">
        ${reviewPanel(submission)}
        <section class="card">
          <div class="card-head"><h3>Versions</h3><a class="small" href="${projectHref(task.project)}">${task.project?.name}</a></div>
          <div class="card-body">${versionList(versions, { currentId: submission.id, hrefFor: (v) => url('admin/submission-review.html', { id: v.id }) })}</div>
        </section>
        <div id="comments"></div>
      </div>
    </div>`,
  );

  renderSubmissionContent($('#content'), { submission, type });
  mountComments($('#comments'), { taskId: task.id, profile });

  on(page, 'click', '[data-decision]', async (event, button) => {
    const form = $('#review-form');
    const decision = button.dataset.decision;
    const feedback = form.feedback.value.trim();
    const message = $('#review-message');
    if (decision === 'request_revision' && !feedback) {
      showFormMessage(message, 'Write a note so they know what to change.');
      form.feedback.focus();
      return;
    }
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    setBusy(button, true);
    try {
      await reviewSubmission(submission.id, decision, feedback);
      flashNext(decision === 'approve' ? 'Approved. The task is completed.' : 'Sent back with your note');
      window.location.replace(url('admin/submission-review.html', { id: submission.id }));
    } catch (error) {
      showFormMessage(message, error.message);
      form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      setBusy(button, false);
    }
  });
}
