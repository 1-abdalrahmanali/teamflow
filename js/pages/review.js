// app/review.html?id=<submission>: read a version, then approve it with a score or
// send it back with feedback. Private notes here are for reviewers only; the database
// never returns them to the person who wrote the work.
import { backLink, mountApp } from '../components/layout.js';
import { renderSubmissionContent } from '../components/submission-view.js';
import { flashNext, toast, toastError } from '../components/toast.js';
import { avatar, emptyState, feedbackNote, reviewStatus, scoreBadge, typeTag, withLoading } from '../components/ui.js';
import { versionList } from '../components/version-list.js';
import { addInternalNote, listInternalNotes, reviewSubmission } from '../submissions/reviews.js';
import { getSubmission, listVersions } from '../submissions/submissions.js';
import { $, escapeHtml, html, icon, render, setBusy } from '../utils/dom.js';
import { firstName, formatDateTime, timeAgo } from '../utils/format.js';
import { go, param, url } from '../utils/paths.js';
import { formatInZone } from '../utils/time.js';
import { showFormMessage } from '../utils/validate.js';

const submissionId = param('id');
const { access, profile, page, setTitle, setActive } = await mountApp({ active: 'review-queue', title: 'Review' });

let dispose = () => {};

async function load() {
  const submission = await getSubmission(submissionId);
  if (!submission) return { submission: null };
  const managing = access.canManage(submission.task?.project_id);
  const canReview = managing && submission.user_id !== profile.id;
  const versions = await listVersions(submission.task_id);
  const notes = canReview ? await listInternalNotes(versions.map((v) => v.id)) : [];
  return { submission, managing, canReview, versions, notes };
}

function decisionForm(submission) {
  const name = firstName(submission.author?.full_name);
  return html`<form class="stack" id="review-form" novalidate>
    <div class="segmented segmented-wide" role="radiogroup" aria-label="Decision">
      <label><input type="radio" name="decision" value="approve" checked><span>${icon('badge-check')}Approve</span></label>
      <label><input type="radio" name="decision" value="request_revision"><span>${icon('rotate-ccw')}Needs changes</span></label>
    </div>
    <div class="field" data-score>
      <label class="field-label" for="score">Score out of 100</label>
      <div class="score-input">
        <input type="range" min="0" max="100" step="1" value="80" id="score-range" aria-label="Score slider">
        <input class="input" type="number" min="0" max="100" step="1" value="80" id="score" name="score" inputmode="numeric">
      </div>
      <span class="field-hint">Counts toward ${name}'s average score.</span>
    </div>
    <label class="field">
      <span class="field-label" data-feedback-label>Feedback for ${name} <span class="faint">(optional)</span></span>
      <textarea class="textarea" name="feedback" rows="5" maxlength="5000" placeholder="What works, and what to change next time."></textarea>
      <span class="field-hint">${name} sees this with the result.</span>
    </label>
    <label class="field private-field">
      <span class="field-label">${icon('lock')}Private note for reviewers <span class="faint">(optional)</span></span>
      <textarea class="textarea" name="internal" rows="3" maxlength="5000" placeholder="Context for other Team Leaders and Platform Admins."></textarea>
      <span class="field-hint">Never shown to ${name}.</span>
    </label>
    <p class="form-message" id="review-message" hidden></p>
    <button class="btn btn-block" type="submit" data-submit>Approve with a score of 80</button>
  </form>`;
}

function notesPanel(notes, versions, submission) {
  const versionOf = new Map(versions.map((v) => [v.id, v.version]));
  return html`<section class="card card-pad stack private-panel">
    <div class="row row-between"><h2 class="section-title">${icon('notebook-pen')}Private reviewer notes</h2>${icon('eye-off')}</div>
    <p class="small muted">Only Team Leaders of this project and Platform Admins see these. ${firstName(submission.author?.full_name)} never does.</p>
    ${notes.length
      ? html`<ul class="notes-list">${notes.map(
          (n) => html`<li>
            <div class="row small">${avatar(n.reviewer || { full_name: '?' }, 'sm')}<span class="strong">${n.reviewer?.full_name || 'Former reviewer'}</span>
              <span class="faint">on version ${versionOf.get(n.submission_id)}, ${timeAgo(n.created_at)}</span></div>
            <p class="prewrap small">${n.content}</p>
          </li>`,
        )}</ul>`
      : html`<p class="small faint">No private notes yet.</p>`}
    <form class="stack-sm" id="note-form" novalidate>
      <textarea class="textarea" name="note" rows="2" maxlength="5000" placeholder="Add a note about version ${submission.version}" aria-label="Private note"></textarea>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-quiet btn-sm" type="submit">${icon('plus')}Add note</button></div>
    </form>
  </section>`;
}

function resultCard(submission) {
  const review = submission.review;
  if (!review) {
    return html`<section class="card card-pad stack-sm">
      <h2 class="section-title">Waiting for review</h2>
      <p class="small muted">${submission.user_id === profile.id
        ? 'This is your own work, so another Team Leader or a Platform Admin has to review it.'
        : 'A Team Leader of this project or a Platform Admin will review it.'}</p>
    </section>`;
  }
  return html`<section class="card card-pad stack">
    <div class="row row-between row-wrap">
      <h2 class="section-title">${review.review_action === 'approved' ? 'Approved' : 'Changes requested'}</h2>
      ${review.score != null ? scoreBadge(review.score, { large: true }) : reviewStatus(submission.review_status)}
    </div>
    ${review.feedback
      ? feedbackNote({ feedback: review.feedback, reviewer: review.reviewer, when: review.created_at })
      : html`<p class="small faint">${review.reviewer?.full_name || 'The reviewer'} approved it ${timeAgo(review.created_at)} without written notes.</p>`}
  </section>`;
}

async function draw() {
  dispose();
  await withLoading(page, load, async ({ submission, managing, canReview, versions, notes }) => {
    if (!submission) {
      render(
        page,
        html`<section class="card">${emptyState({
          iconName: 'file-question',
          title: 'This submission is not available',
          body: 'It may have been deleted, or it belongs to a project you do not manage.',
          action: html`<a class="btn btn-quiet" href="${url('app/home.html')}">Go home</a>`,
        })}</section>`,
      );
      return;
    }
    const task = submission.task;
    const zone = task?.project?.timezone || 'UTC';
    const pending = submission.review_status === 'pending';
    const latest = versions.at(-1);
    setTitle(`${task?.title || 'Task'}, version ${submission.version}`, `${submission.author?.full_name || 'Former member'} in ${task?.project?.name || 'a project'}`);
    if (managing) setActive(access.leadsAny || access.isAdmin ? 'review-queue' : `project:${task?.project_id}`);

    render(
      page,
      html`${backLink(url(managing ? 'app/review-queue.html' : 'app/task.html', managing ? undefined : { id: submission.task_id }), managing ? 'Review queue' : 'Back to the task')}
      <div class="review-head card card-pad">
        <span class="person">${avatar(submission.author, 'lg')}<span class="grow">
          <span class="person-name">${submission.author?.full_name || 'Former member'}</span>
          <span class="person-meta" title="${formatDateTime(submission.submitted_at)}">Sent version ${submission.version} ${timeAgo(submission.submitted_at)}${
            task?.deadline ? html`, deadline ${formatInZone(task.deadline, zone)}` : ''
          }</span></span></span>
        <div class="row row-wrap" style="gap:var(--s-2)">${typeTag(submission.submission_type)}${reviewStatus(submission.review_status)}
          <a class="btn btn-ghost btn-sm" href="${url('app/task.html', { id: submission.task_id })}">${icon('file-text')}Open the task</a></div>
      </div>
      ${latest && latest.id !== submission.id
        ? html`<div class="callout">${icon('info')}<span>A newer version exists. <a href="${url('app/review.html', { id: latest.id })}">Open version ${latest.version}</a>.</span></div>`
        : ''}
      <div class="review-layout">
        <div class="stack-lg">
          <section class="stack-sm"><h2 class="section-title">What they sent</h2><div data-content></div></section>
          <details class="card card-pad brief-toggle">
            <summary class="strong">${icon('file-text')}The brief they worked from</summary>
            <p class="prewrap" style="margin-top:var(--s-3)">${task?.description || 'No description.'}</p>
          </details>
          <section class="card card-pad stack">
            <h2 class="section-title">${icon('history')}Review history</h2>
            ${versionList(versions, { currentId: submission.id, hrefFor: (v) => url('app/review.html', { id: v.id }) })}
          </section>
        </div>
        <aside class="stack">
          ${pending && canReview
            ? html`<section class="card card-pad stack"><h2 class="section-title">Your review</h2>${decisionForm(submission)}</section>`
            : pending && managing
              ? html`<div class="callout callout-red">${icon('shield-alert')}<span>You cannot review your own work. Another Team Leader of this project or a Platform Admin has to.</span></div>`
              : resultCard(submission)}
          ${canReview ? notesPanel(notes, versions, submission) : ''}
        </aside>
      </div>`,
    );

    renderSubmissionContent($('[data-content]', page), { submission })
      .then((release) => {
        dispose = release;
      })
      .catch(toastError);

    const form = $('#review-form', page);
    if (form) wireDecision(form, submission);
    const noteForm = $('#note-form', page);
    noteForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('[type="submit"]', noteForm);
      setBusy(button, true);
      try {
        await addInternalNote(submission.id, noteForm.note.value.trim());
        toast('Note added');
        await draw();
      } catch (error) {
        toastError(error);
        setBusy(button, false);
      }
    });
  });
}

function wireDecision(form, submission) {
  const range = $('#score-range', form);
  const number = form.score;
  const submit = $('[data-submit]', form);
  const name = firstName(submission.author?.full_name);
  const message = $('#review-message', form);
  const sync = () => {
    const approving = form.decision.value === 'approve';
    $('[data-score]', form).hidden = !approving;
    $('[data-feedback-label]', form).innerHTML = approving
      ? `Feedback for ${escapeHtml(name)} <span class="faint">(optional)</span>`
      : `What should ${escapeHtml(name)} change?`;
    form.feedback.placeholder = approving ? 'What works, and what to change next time.' : 'Be specific: what is wrong, and what good looks like.';
    submit.textContent = approving ? `Approve with a score of ${number.value || 0}` : 'Send back with notes';
    submit.classList.toggle('btn-good', approving);
  };
  range.addEventListener('input', () => {
    number.value = range.value;
    sync();
  });
  number.addEventListener('input', () => {
    const value = Math.max(0, Math.min(100, Math.round(Number(number.value) || 0)));
    range.value = String(value);
    sync();
  });
  form.addEventListener('change', (event) => {
    if (event.target.name === 'decision') sync();
  });
  sync();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const decision = form.decision.value;
    const feedback = form.feedback.value.trim();
    const raw = number.value.trim();
    const score = Number(raw);
    if (decision === 'approve' && (raw === '' || !Number.isInteger(score) || score < 0 || score > 100)) {
      showFormMessage(message, 'Give a whole-number score from 0 to 100.');
      number.focus();
      return;
    }
    if (decision === 'request_revision' && !feedback) {
      showFormMessage(message, `Write what ${name} should change, so they know what to fix.`);
      form.feedback.focus();
      return;
    }
    setBusy(submit, true);
    try {
      await reviewSubmission({ submissionId: submission.id, decision, feedback, score, internalNote: form.internal.value.trim() });
      flashNext(decision === 'approve' ? `Approved with a score of ${score}` : `Sent back to ${name} with notes`);
      go('app/review-queue.html');
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(submit, false);
    }
  });
}

await draw();
