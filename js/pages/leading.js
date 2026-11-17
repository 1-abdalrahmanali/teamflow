// app/leading.html: a Team Leader's view of the projects they lead: what is waiting
// for review, what is late, and how each person is doing.
import { mountApp } from '../components/layout.js';
import { avatar, emptyState, scoreBadge, withLoading } from '../components/ui.js';
import { taskRow } from '../components/task-row.js';
import { listMembers } from '../members/members.js';
import { memberPerformance } from '../performance/performance.js';
import { listSubmissions } from '../submissions/submissions.js';
import { listTasks } from '../tasks/tasks.js';
import { html, icon, render } from '../utils/dom.js';
import { firstName, greeting, plural } from '../utils/format.js';
import { url } from '../utils/paths.js';

const { access, profile, page, setTitle } = await mountApp({ active: 'leading', title: 'Team overview', need: 'manager' });
setTitle(`${greeting()}, ${firstName(profile.full_name)}`, 'The projects you lead, at a glance.');

const led = access.memberships.filter((m) => m.role === 'team_leader' && m.project);

async function loadProject(membership) {
  const projectId = membership.project_id;
  const [tasks, people] = await Promise.all([listTasks({ projectId }), listMembers(projectId)]);
  const [submissions, numbers] = await Promise.all([
    listSubmissions({ taskIds: tasks.map((t) => t.id), reviewStatus: 'pending' }),
    Promise.all(people.map((m) => memberPerformance(m.user_id, projectId).catch(() => null))),
  ]);
  return { project: membership.project, tasks, people, numbers, waiting: submissions.filter((s) => s.user_id !== profile.id) };
}

await withLoading(
  page,
  () => Promise.all(led.map(loadProject)),
  (projects) => {
    if (!projects.length) {
      render(
        page,
        html`<section class="card">${emptyState({
          iconName: 'crown',
          title: 'You do not lead a project yet',
          body: 'A Platform Admin makes people Team Leaders of a project.',
        })}</section>`,
      );
      return;
    }
    const now = Date.now();
    render(
      page,
      projects.map(({ project, tasks, people, numbers, waiting }) => {
        const overdue = tasks.filter((t) => t.status !== 'completed' && t.deadline && new Date(t.deadline).getTime() < now);
        const unassigned = tasks.filter((t) => !t.assigned_to && t.status !== 'completed');
        const completed = tasks.filter((t) => t.status === 'completed').length;
        return html`<section class="lead-project stack">
          <div class="row row-between row-wrap">
            <h2 class="lead-title"><a href="${url('app/project.html', { id: project.id })}">${project.name}</a>
              ${project.status === 'archived' ? html`<span class="status">Archived</span>` : ''}</h2>
            <a class="btn btn-quiet btn-sm" href="${url('app/project.html', { id: project.id, tab: 'tasks' })}">${icon('list-checks')}All tasks</a>
          </div>
          <div class="stat-grid">
            <a class="stat ${waiting.length ? 'is-attention' : ''}" href="${url('app/review-queue.html')}"><span class="stat-value">${waiting.length}</span><span class="stat-label">Waiting for review</span></a>
            <a class="stat ${overdue.length ? 'is-late' : ''}" href="${url('app/project.html', { id: project.id, tab: 'tasks' })}"><span class="stat-value">${overdue.length}</span><span class="stat-label">Overdue</span></a>
            <a class="stat" href="${url('app/project.html', { id: project.id, tab: 'tasks' })}"><span class="stat-value">${unassigned.length}</span><span class="stat-label">Not assigned</span></a>
            <a class="stat" href="${url('app/project.html', { id: project.id, tab: 'tasks' })}"><span class="stat-value">${completed}<span class="stat-of">/${tasks.length}</span></span><span class="stat-label">Completed</span></a>
          </div>
          <div class="grid-2">
            <section class="card">
              <div class="card-head"><h3 class="section-title">Needs attention</h3></div>
              ${overdue.length || unassigned.length
                ? html`<div>${[...overdue, ...unassigned.filter((t) => !overdue.includes(t))].slice(0, 6).map((t) => taskRow(t, { showAssignee: true }))}</div>`
                : html`<p class="card-body muted small">Nothing is late or unassigned.</p>`}
            </section>
            <section class="card">
              <div class="card-head"><h3 class="section-title">The team</h3><span class="small faint">${plural(people.length, 'person', 'people')}</span></div>
              <ul class="team-list">${people.map((m, i) => {
                const n = numbers[i];
                return html`<li>${avatar(m.user)}<span class="grow"><span class="strong">${m.user?.full_name || 'Former member'}</span>
                    <span class="small faint">${n ? `${n.completed_tasks} of ${n.assigned_tasks} done` : ''}${m.role === 'team_leader' ? ', Team Leader' : ''}</span></span>
                  ${n?.average_score != null ? scoreBadge(n.average_score) : html`<span class="small faint">No score</span>`}</li>`;
              })}</ul>
            </section>
          </div>
        </section>`;
      }),
    );
  },
);
