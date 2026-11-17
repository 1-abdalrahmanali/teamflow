// app/dashboard.html: a person's own work. Exactly three numbers (Assigned Tasks,
// Completed Tasks, Average Score), then what to do next and the latest feedback.
import { mountApp } from '../components/layout.js';
import { emptyState, feedbackNote, scoreBadge, withLoading } from '../components/ui.js';
import { taskRow } from '../components/task-row.js';
import { memberPerformance } from '../performance/performance.js';
import { listSubmissions } from '../submissions/submissions.js';
import { blockedTaskIds, listTasks } from '../tasks/tasks.js';
import { html, icon, render } from '../utils/dom.js';
import { firstName, greeting, plural } from '../utils/format.js';
import { url } from '../utils/paths.js';

const { profile, page, setTitle } = await mountApp({ active: 'dashboard', title: 'Dashboard' });
setTitle(`${greeting()}, ${firstName(profile.full_name)}`, 'Your work across every project you are in.');

// The score dial: a half circle filled to the average.
function dial(score) {
  const value = score ?? 0;
  const length = Math.PI * 80;
  const filled = (Math.max(0, Math.min(100, value)) / 100) * length;
  const tone = score == null ? 'none' : value >= 80 ? 'good' : value >= 50 ? 'mid' : 'low';
  return html`<svg class="dial dial-${tone}" viewBox="0 0 200 112" role="img" aria-label="${score == null ? 'No score yet' : `Average score ${score} out of 100`}">
    <path class="dial-track" d="M20 100 A80 80 0 0 1 180 100" />
    <path class="dial-fill" d="M20 100 A80 80 0 0 1 180 100" stroke-dasharray="${filled} ${length}" />
  </svg>`;
}

const ORDER = { revision_required: 0, in_progress: 1, todo: 2, submitted: 3, completed: 4 };

await withLoading(
  page,
  async () => {
    const [numbers, tasks, reviewed] = await Promise.all([
      memberPerformance(profile.id),
      listTasks({ assignedTo: profile.id }),
      listSubmissions({ userId: profile.id, limit: 12 }),
    ]);
    const open = tasks.filter((t) => t.status !== 'completed');
    const blocked = await blockedTaskIds(open.filter((t) => t.status === 'todo').map((t) => t.id));
    return { numbers, tasks, open, blocked, reviewed: reviewed.filter((s) => s.review).slice(0, 3) };
  },
  ({ numbers, tasks, open, blocked, reviewed }) => {
    const assigned = numbers.assigned_tasks ?? 0;
    const completed = numbers.completed_tasks ?? 0;
    const average = numbers.average_score;
    const share = assigned ? Math.round((completed / assigned) * 100) : 0;
    const upNext = [...open].sort(
      (a, b) => ORDER[a.status] - ORDER[b.status] || Number(blocked.has(a.id)) - Number(blocked.has(b.id)),
    );
    const sentBack = open.filter((t) => t.status === 'revision_required').length;

    render(
      page,
      html`<section class="metrics" aria-label="Your numbers">
          <div class="metric">
            <p class="metric-label">${icon('list-checks')}Assigned tasks</p>
            <p class="metric-value">${assigned}</p>
            <p class="metric-note">${open.length ? `${plural(open.length, 'task')} still open` : assigned ? 'Nothing open right now' : 'Nothing assigned yet'}</p>
          </div>
          <div class="metric">
            <p class="metric-label">${icon('circle-check')}Completed tasks</p>
            <p class="metric-value">${completed}</p>
            <div class="progress" aria-hidden="true"><span style="width:${share}%"></span></div>
            <p class="metric-note">${assigned ? `${share}% of everything assigned to you` : 'Approved work counts here'}</p>
          </div>
          <div class="metric metric-score">
            <p class="metric-label">${icon('star')}Average score</p>
            <div class="dial-wrap">${dial(average)}<p class="dial-value">${average ?? '--'}</p></div>
            <p class="metric-note">${average == null ? 'Scores appear once work is approved' : 'Out of 100, across your approved work'}</p>
          </div>
        </section>

        ${sentBack
          ? html`<div class="callout callout-red">${icon('rotate-ccw')}<span><strong>${plural(sentBack, 'task')} came back with notes.</strong>
              Read the feedback, make the changes and send a new version.</span></div>`
          : ''}

        <div class="grid-2">
          <section class="card">
            <div class="card-head"><h2 class="section-title">Up next</h2>
              <a class="small" href="${url('app/tasks.html')}">All my tasks</a></div>
            ${upNext.length
              ? html`<div>${upNext.slice(0, 6).map((t) => taskRow(t, { blocked: blocked.has(t.id), showProject: true }))}</div>`
              : emptyState({
                  iconName: tasks.length ? 'party-popper' : 'coffee',
                  title: tasks.length ? 'All done for now' : 'No tasks yet',
                  body: tasks.length
                    ? 'Everything assigned to you is completed. New tasks will show up here.'
                    : 'When a Team Leader assigns you a task, it shows up here.',
                })}
          </section>
          <section class="card">
            <div class="card-head"><h2 class="section-title">Latest feedback</h2>
              <a class="small" href="${url('app/submissions.html')}">All submissions</a></div>
            <div class="card-body stack">
              ${reviewed.length
                ? reviewed.map(
                    (s) => html`<div class="stack-sm">
                      <div class="row row-between row-wrap">
                        <a class="strong" href="${url('app/task.html', { id: s.task_id })}">${s.task?.title || 'Task'}</a>
                        ${s.review.score != null ? scoreBadge(s.review.score) : html`<span class="status status-red">Changes requested</span>`}
                      </div>
                      ${s.review.feedback
                        ? feedbackNote({ feedback: s.review.feedback, reviewer: s.review.reviewer, when: s.review.created_at })
                        : html`<p class="small faint">Version ${s.version} approved without written notes.</p>`}
                    </div>`,
                  )
                : html`<p class="muted small">Reviews of your work will show here, with the score and any notes.</p>`}
            </div>
          </section>
        </div>`,
    );
  },
);
