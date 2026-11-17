// app/submissions.html: every version I have handed in, with its review.
import { mountApp } from '../components/layout.js';
import { emptyState, reviewStatus, scoreBadge, typeTag, withLoading } from '../components/ui.js';
import { listSubmissions } from '../submissions/submissions.js';
import { html, render } from '../utils/dom.js';
import { formatDateTime, timeAgo } from '../utils/format.js';
import { url } from '../utils/paths.js';

const { profile, page } = await mountApp({
  active: 'my-submissions',
  title: 'My submissions',
  subtitle: 'Every version you have sent, newest first. Nothing is ever overwritten.',
});

await withLoading(
  page,
  () => listSubmissions({ userId: profile.id }),
  (submissions) => {
    if (!submissions.length) {
      render(
        page,
        html`<section class="card">${emptyState({
          iconName: 'history',
          title: 'Nothing submitted yet',
          body: 'When you hand in work on a task, each version is kept here with its review.',
          action: html`<a class="btn" href="${url('app/tasks.html')}">Open my tasks</a>`,
        })}</section>`,
      );
      return;
    }
    render(
      page,
      html`<section class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Task</th><th>Version</th><th>Sent</th><th>Review</th><th>Score</th></tr></thead>
        <tbody>
          ${submissions.map(
            (s) => html`<tr>
              <td><a class="strong" href="${url('app/task.html', { id: s.task_id })}">${s.task?.title || 'Task'}</a>
                <div class="small faint">${s.task?.project?.name || ''}</div></td>
              <td><span class="nowrap">Version ${s.version}</span> ${typeTag(s.submission_type)}</td>
              <td class="nowrap" title="${formatDateTime(s.submitted_at)}">${timeAgo(s.submitted_at)}</td>
              <td>${reviewStatus(s.review_status)}</td>
              <td>${s.review?.score != null ? scoreBadge(s.review.score) : html`<span class="faint">None</span>`}</td>
            </tr>`,
          )}
        </tbody>
      </table></div></section>`,
    );
  },
);
