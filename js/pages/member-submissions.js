// member/submissions.html: every version this person has handed in.
import { listSubmissions } from '../submissions/submissions.js';
import { html, render } from '../utils/dom.js';
import { formatDateTime, timeAgo } from '../utils/format.js';
import { mountApp } from '../components/layout.js';
import { emptyState, reviewStatus, withLoading } from '../components/ui.js';
import { submissionKind } from './admin-shared.js';
import { taskHref } from './member-shared.js';

const { profile, page } = await mountApp({
  area: 'member',
  active: 'submissions',
  title: 'Submission history',
  subtitle: 'Every version you have handed in, and what happened to it.',
});

await withLoading(
  page,
  () => listSubmissions({ userId: profile.id }),
  (submissions) => {
    render(
      page,
      submissions.length
        ? html`<section class="card"><div class="table-wrap"><table class="table">
            <thead><tr><th>Task</th><th>Project</th><th>Version</th><th>Submitted</th><th>Type</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>${submissions.map(
              (s) => html`<tr>
                <td data-label="Task"><a class="cell-title" href="${taskHref({ id: s.task_id })}">${s.task?.title || 'Deleted task'}</a></td>
                <td data-label="Project">${s.task?.project?.name || ''}</td>
                <td data-label="Version">${s.version}</td>
                <td data-label="Submitted" title="${formatDateTime(s.submitted_at)}" class="nowrap">${timeAgo(s.submitted_at)}</td>
                <td data-label="Type">${submissionKind(s)}</td>
                <td data-label="Status">${reviewStatus(s.review_status)}</td>
                <td data-label="Note" class="small muted" style="max-width:280px">${s.feedback ? (s.feedback.length > 120 ? `${s.feedback.slice(0, 120)}...` : s.feedback) : ''}</td>
              </tr>`,
            )}</tbody>
          </table></div></section>`
        : html`<div class="card">${emptyState({ iconName: 'history', title: 'Nothing submitted yet', body: 'Each time you submit work on a task, the version is kept here with its review.' })}</div>`,
    );
  },
);
