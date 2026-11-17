// app/review-queue.html: work waiting for this person's review, longest wait first.
// Only projects they manage appear, and never their own work.
import { mountApp } from '../components/layout.js';
import { avatar, emptyState, reviewStatus, scoreBadge, typeTag, withLoading } from '../components/ui.js';
import { listSubmissions } from '../submissions/submissions.js';
import { html, icon, render } from '../utils/dom.js';
import { formatDateTime, plural, timeAgo } from '../utils/format.js';
import { url } from '../utils/paths.js';
import { deadlineInfo } from '../utils/time.js';

const { access, profile, page } = await mountApp({
  active: 'review-queue',
  title: 'Review queue',
  subtitle: 'Approve with a score, or send work back with notes.',
  need: 'manager',
});

await withLoading(
  page,
  async () => {
    const all = await listSubmissions({ excludeUserId: profile.id, limit: 200 });
    const mine = all.filter((s) => access.canManage(s.task?.project_id));
    return {
      waiting: mine.filter((s) => s.review_status === 'pending').reverse(),
      done: mine.filter((s) => s.review_status !== 'pending').slice(0, 10),
    };
  },
  ({ waiting, done }) => {
    const waitingRow = (s) => {
      const zone = s.task?.project?.timezone || 'UTC';
      const due = s.task?.deadline ? deadlineInfo(s.task.deadline, 'submitted', zone, new Date(s.submitted_at).getTime()) : null;
      const late = due?.tone === 'late';
      return html`<a class="queue-row" href="${url('app/review.html', { id: s.id })}">
        ${avatar(s.author)}
        <div class="grow" style="min-width:0">
          <p class="strong">${s.task?.title || 'Task'} <span class="faint small">version ${s.version}</span></p>
          <p class="small faint">${s.author?.full_name || 'Former member'} in ${s.task?.project?.name || 'a project'}${late ? html`, <span class="due-late">sent after the deadline</span>` : ''}</p>
        </div>
        ${typeTag(s.submission_type)}
        <span class="queue-wait" title="${formatDateTime(s.submitted_at)}">${icon('clock')}${timeAgo(s.submitted_at)}</span>
        <span class="btn btn-sm">Review</span>
      </a>`;
    };
    render(
      page,
      html`<section class="card">
          <div class="card-head"><h2 class="section-title">Waiting for you (${waiting.length})</h2>
            ${waiting.length ? html`<span class="small faint">Oldest first</span>` : ''}</div>
          ${waiting.length
            ? html`<div>${waiting.map(waitingRow)}</div>`
            : emptyState({
                iconName: 'inbox',
                title: 'Nothing to review',
                body: 'When someone in a project you manage hands in work, it lands here.',
              })}
        </section>
        ${done.length
          ? html`<section class="card">
              <div class="card-head"><h2 class="section-title">Reviewed recently</h2></div>
              <div class="table-wrap"><table class="table">
                <thead><tr><th>Task</th><th>From</th><th>Result</th><th>Score</th><th>When</th></tr></thead>
                <tbody>${done.map(
                  (s) => html`<tr>
                    <td><a class="strong" href="${url('app/review.html', { id: s.id })}">${s.task?.title || 'Task'}</a><div class="small faint">Version ${s.version}</div></td>
                    <td>${s.author?.full_name || 'Former member'}</td>
                    <td>${reviewStatus(s.review_status)}</td>
                    <td>${s.review?.score != null ? scoreBadge(s.review.score) : ''}</td>
                    <td class="nowrap">${s.review ? timeAgo(s.review.created_at) : ''}${s.review?.reviewer && s.review.reviewer.id !== profile.id ? html`<div class="small faint">by ${s.review.reviewer.full_name}</div>` : ''}</td>
                  </tr>`,
                )}</tbody></table></div>
            </section>`
          : ''}
        ${waiting.length > 5 ? html`<p class="small faint">${plural(waiting.length, 'submission')} waiting. Reviewing the oldest first keeps everyone moving.</p>` : ''}`,
    );
  },
);
