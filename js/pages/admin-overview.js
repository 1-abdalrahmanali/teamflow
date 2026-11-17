// app/admin/overview.html: the whole platform for a Platform Admin.
import { mountApp } from '../components/layout.js';
import { openProjectDialog } from '../components/project-dialog.js';
import { avatar, withLoading } from '../components/ui.js';
import { overviewStats } from '../performance/performance.js';
import { activityHref, describeActivity, listActivity } from '../projects/projects.js';
import { html, icon, render } from '../utils/dom.js';
import { firstName, formatDateTime, greeting, timeAgo } from '../utils/format.js';
import { go, url } from '../utils/paths.js';

const { profile, page, actions, setTitle } = await mountApp({ active: 'admin-overview', title: 'Platform overview', need: 'admin' });
setTitle(`${greeting()}, ${firstName(profile.full_name)}`, 'Everything on TeamFlow, in one place.');

render(actions, html`<button class="btn" type="button" id="new-project">${icon('plus')}New project</button>`);
actions.querySelector('#new-project').addEventListener('click', () =>
  openProjectDialog({ onSaved: (project) => go('app/project.html', { id: project.id }) }),
);

await withLoading(
  page,
  () => Promise.all([overviewStats(), listActivity({ limit: 15 })]),
  ([stats, activity]) => {
    const stat = (value, label, href, extra = '') =>
      html`<a class="stat ${extra}" href="${href}"><span class="stat-value">${value ?? 0}</span><span class="stat-label">${label}</span></a>`;
    render(
      page,
      html`<section class="stat-grid stat-grid-4">
          ${stat(stats.active_projects, `Active projects (${stats.total_projects} in all)`, url('app/projects.html'))}
          ${stat(stats.total_users, 'People on the platform', url('app/admin/users.html'))}
          ${stat(stats.open_tasks, `Open tasks (${stats.total_tasks} in all)`, url('app/projects.html'))}
          ${stat(stats.completed_tasks, 'Completed tasks', url('app/projects.html'))}
          ${stat(stats.pending_reviews, 'Waiting for review', url('app/review-queue.html'), stats.pending_reviews ? 'is-attention' : '')}
          ${stat(stats.overdue_tasks, 'Overdue tasks', url('app/projects.html'), stats.overdue_tasks ? 'is-late' : '')}
        </section>
        <div class="grid-2">
          <section class="card">
            <div class="card-head"><h2 class="section-title">Latest activity</h2></div>
            <div class="card-body">
              ${activity.length
                ? html`<ul class="feed">${activity.map((entry) => {
                    const href = activityHref(entry, url);
                    const sentence = html`<strong>${entry.actor?.full_name || 'Someone'}</strong> ${describeActivity(entry)}${
                      entry.project ? html` <span class="faint">in ${entry.project.name}</span>` : ''
                    }`;
                    return html`<li>${avatar(entry.actor || { full_name: '?' }, 'sm')}<span class="grow">${href ? html`<a class="plain-link" href="${href}">${sentence}</a>` : sentence}</span>
                      <time title="${formatDateTime(entry.created_at)}">${timeAgo(entry.created_at)}</time></li>`;
                  })}</ul>`
                : html`<p class="muted small">Nothing has happened yet. Create a project to get started.</p>`}
            </div>
          </section>
          <section class="card card-pad stack">
            <h2 class="section-title">Getting a project going</h2>
            <ol class="howto">
              <li><span class="strong">Create the project</span><span class="small muted">Pick its time zone so deadlines read right for the team.</span></li>
              <li><span class="strong">Invite people</span><span class="small muted">Each gets an emailed link that works once, for their address.</span></li>
              <li><span class="strong">Choose a Team Leader</span><span class="small muted">In the project's People tab, make someone Team Leader. They plan and review from there.</span></li>
            </ol>
            <a class="btn btn-quiet" href="${url('app/admin/users.html')}">${icon('user-cog')}Users and roles</a>
          </section>
        </div>`,
    );
  },
);
