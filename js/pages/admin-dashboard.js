// admin/dashboard.html
import { describeActivity, getDashboardStats, listActivity } from '../projects/projects.js';
import { listTasks } from '../tasks/tasks.js';
import { listSubmissions } from '../submissions/submissions.js';
import { html, on, render } from '../utils/dom.js';
import { firstName, greeting, plural, timeAgo } from '../utils/format.js';
import { url } from '../utils/paths.js';
import { mountApp } from '../components/layout.js';
import { avatar, emptyState, withLoading } from '../components/ui.js';
import { openProjectDialog } from '../components/project-dialog.js';
import { newProjectButton, ownedProjects, projectHref, reviewHref, submissionKind } from './admin-shared.js';

const { profile, page, actions, setTitle } = await mountApp({ area: 'admin', active: 'dashboard', title: 'Dashboard' });
setTitle(`${greeting()}, ${firstName(profile.full_name)}`, 'Here is where your projects stand today.');
render(actions, newProjectButton());
on(document, 'click', '[data-action="new-project"]', () =>
  openProjectDialog({ onSaved: (project) => window.location.assign(projectHref(project)) }),
);

async function load() {
  const [stats, projects, waiting, activity, tasks] = await Promise.all([
    getDashboardStats(),
    ownedProjects(profile),
    listSubmissions({ reviewStatus: 'pending', excludeUserId: profile.id, limit: 6 }),
    listActivity({ limit: 10 }),
    listTasks(),
  ]);
  return { stats, projects, waiting, activity, tasks };
}

function progressFor(project, tasks) {
  const mine = tasks.filter((t) => t.project_id === project.id);
  const done = mine.filter((t) => t.status === 'completed').length;
  return { total: mine.length, done, percent: mine.length ? Math.round((done / mine.length) * 100) : 0 };
}

await withLoading(page, load, ({ stats, projects, waiting, activity, tasks }) => {
  if (!projects.length) {
    render(
      page,
      html`<div class="card">${emptyState({
        iconName: 'folder-kanban',
        title: 'Start with your first project',
        body: 'A project holds its own tasks, members and reviews. Create one, then invite the people who will work on it.',
        action: newProjectButton(),
      })}</div>`,
    );
    return;
  }

  const ownTasks = tasks.filter((t) => projects.some((p) => p.id === t.project_id));
  const active = projects.filter((p) => p.status === 'active');

  render(
    page,
    html`<div class="stat-grid">
        <a class="stat" href="${url('admin/projects.html')}"><div class="stat-value">${projects.length}</div><div class="stat-label">Total projects</div></a>
        <div class="stat"><div class="stat-value">${active.length}</div><div class="stat-label">Active projects</div></div>
        <div class="stat"><div class="stat-value">${ownTasks.length}</div><div class="stat-label">Total tasks</div></div>
        <div class="stat"><div class="stat-value">${ownTasks.filter((t) => t.status === 'completed').length}</div><div class="stat-label">Completed tasks</div></div>
        <div class="stat"><div class="stat-value">${ownTasks.filter((t) => t.status !== 'completed').length}</div><div class="stat-label">Pending tasks</div></div>
        <a class="stat ${stats.pending_reviews ? 'is-attention' : ''}" href="${url('admin/submissions.html')}">
          <div class="stat-value">${stats.pending_reviews}</div><div class="stat-label">Waiting for your review</div></a>
      </div>

      <div class="grid-2">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h3>Waiting for your review</h3>
              ${waiting.length ? html`<a class="small" href="${url('admin/submissions.html')}">See all</a>` : ''}</div>
            ${waiting.length
              ? waiting.map(
                  (s) => html`<a class="task-row" href="${reviewHref(s)}">
                    ${avatar(s.author)}
                    <div class="grow">
                      <div class="task-row-title">${s.task?.title}</div>
                      <div class="task-row-meta"><span>${s.author?.full_name}</span><span>Version ${s.version}</span>
                        <span>${submissionKind(s)}</span><span>${timeAgo(s.submitted_at)}</span></div>
                    </div>
                    <span class="btn btn-sm">Review</span>
                  </a>`,
                )
              : emptyState({ iconName: 'coffee', title: 'Nothing to review', body: 'New submissions will appear here as soon as someone sends one.' })}
          </section>

          <section class="card">
            <div class="card-head"><h3>Project progress</h3><a class="small" href="${url('admin/projects.html')}">All projects</a></div>
            ${active.length
              ? active.slice(0, 6).map((p) => {
                  const progress = progressFor(p, ownTasks);
                  return html`<a class="task-row" href="${projectHref(p)}">
                    <div class="grow">
                      <div class="task-row-title">${p.name}</div>
                      <div class="progress" style="margin-top:8px" role="img" aria-label="${progress.percent}% of tasks completed"><span style="width:${progress.percent}%"></span></div>
                    </div>
                    <span class="small faint nowrap">${progress.done} of ${plural(progress.total, 'task')} done</span>
                  </a>`;
                })
              : html`<p class="card-body muted">All your projects are archived.</p>`}
          </section>
        </div>

        <section class="card">
          <div class="card-head"><h3>Recent activity</h3></div>
          <div class="card-body" style="padding-top:var(--s-2)">
            ${activity.length
              ? html`<ul class="feed">${activity.map(
                  (entry) => html`<li>${avatar(entry.actor, 'sm')}
                    <div class="grow"><span class="strong">${entry.actor?.id === profile.id ? 'You' : entry.actor?.full_name || 'Someone'}</span>
                      ${describeActivity(entry)}
                      <div class="tiny faint">${entry.project?.name}</div></div>
                    <time datetime="${entry.created_at}">${timeAgo(entry.created_at)}</time></li>`,
                )}</ul>`
              : html`<p class="muted small" style="padding:var(--s-4) 0">Activity shows up here as your team works.</p>`}
          </div>
        </section>
      </div>`,
  );
});
