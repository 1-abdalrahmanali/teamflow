// member/dashboard.html
import { listTasks } from '../tasks/tasks.js';
import { listSubmissions } from '../submissions/submissions.js';
import { html, render } from '../utils/dom.js';
import { firstName, greeting, timeAgo } from '../utils/format.js';
import { url } from '../utils/paths.js';
import { mountApp } from '../components/layout.js';
import { emptyState, feedbackNote, withLoading } from '../components/ui.js';
import { joinedProjects, sortTasks, taskHref, taskRow } from './member-shared.js';

const { profile, page, setTitle } = await mountApp({ area: 'member', active: 'dashboard', title: 'Dashboard' });
setTitle(`${greeting()}, ${firstName(profile.full_name)}`, 'Your work across every project you have joined.');

await withLoading(
  page,
  async () => {
    const [projects, tasks, reviewed] = await Promise.all([
      joinedProjects(profile),
      listTasks({ assignedTo: profile.id }),
      listSubmissions({ userId: profile.id, limit: 20 }),
    ]);
    return { projects, tasks, reviewed: reviewed.filter((s) => s.review_status !== 'pending' && s.feedback).slice(0, 3) };
  },
  ({ projects, tasks, reviewed }) => {
    if (!projects.length) {
      render(
        page,
        html`<div class="card">${emptyState({
          iconName: 'mail',
          title: 'You have not joined a project yet',
          body: 'Ask your project owner for an invitation link. Open it while signed in with this email and the project appears here.',
        })}</div>`,
      );
      return;
    }

    // "Up next" is work still to do; tasks waiting for review are counted separately.
    const open = sortTasks(tasks.filter((t) => ['todo', 'in_progress', 'revision_required'].includes(t.status)));
    const needsChanges = tasks.filter((t) => t.status === 'revision_required');
    const stats = [
      ['Projects', projects.length, url('member/projects.html')],
      ['To work on', open.length, url('member/tasks.html')],
      ['Waiting for review', tasks.filter((t) => t.status === 'submitted').length, url('member/tasks.html')],
      ['Completed', tasks.filter((t) => t.status === 'completed').length, url('member/tasks.html')],
    ];

    render(
      page,
      html`<div class="stat-grid">
        ${stats.map(([label, value, href]) => html`<a class="stat" href="${href}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></a>`)}
      </div>

      ${needsChanges.length
        ? html`<div class="form-message is-error">${needsChanges.length === 1 ? 'One task was' : `${needsChanges.length} tasks were`} sent back with notes.
            <a href="${taskHref(needsChanges[0])}">Open ${needsChanges.length === 1 ? 'it' : 'the first one'}</a>.</div>`
        : ''}

      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h3>Up next</h3><a class="small" href="${url('member/tasks.html')}">All my tasks</a></div>
          ${open.length
            ? open.slice(0, 8).map((t) => taskRow(t))
            : emptyState({ iconName: 'circle-check', title: 'Nothing to work on right now', body: 'Tasks waiting for review are not listed here. New tasks show up as soon as they are assigned to you.' })}
        </section>

        <section class="card">
          <div class="card-head"><h3>Latest notes on your work</h3></div>
          <div class="card-body stack">
            ${reviewed.length
              ? reviewed.map(
                  (s) => html`<div class="stack-sm">
                    <a class="strong" href="${taskHref({ id: s.task_id })}">${s.task?.title}</a>
                    <p class="tiny faint">Version ${s.version}, reviewed ${timeAgo(s.reviewed_at)}</p>
                    ${feedbackNote({ feedback: s.feedback, reviewer: s.reviewer, when: null })}
                  </div>`,
                )
              : html`<p class="muted small">When your work is reviewed, the notes you get appear here.</p>`}
          </div>
        </section>
      </div>`,
    );
  },
);
