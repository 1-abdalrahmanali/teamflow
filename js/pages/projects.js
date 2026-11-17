// app/projects.html: the projects this person can open. Platform Admins see all of
// them and can create new ones; everyone else sees the projects they belong to.
import { mountApp } from '../components/layout.js';
import { openProjectDialog } from '../components/project-dialog.js';
import { emptyState, roleTag, withLoading } from '../components/ui.js';
import { listProjects } from '../projects/projects.js';
import { html, icon, render } from '../utils/dom.js';
import { formatDate, plural } from '../utils/format.js';
import { go, url } from '../utils/paths.js';
import { zoneLabel } from '../utils/time.js';

const { access, page, actions } = await mountApp({ active: 'projects', title: 'Projects' });

const { isAdmin } = access;
if (isAdmin) {
  render(actions, html`<button class="btn" type="button" id="new-project">${icon('plus')}New project</button>`);
  actions.querySelector('#new-project').addEventListener('click', () =>
    openProjectDialog({ onSaved: (project) => go('app/project.html', { id: project.id }) }),
  );
}

function card(project) {
  const role = access.roleIn(project.id);
  const members = project.project_members?.[0]?.count ?? 0;
  return html`<a class="card project-card ${project.status === 'archived' ? 'is-archived' : ''}" href="${url('app/project.html', { id: project.id })}">
    <div class="row row-between" style="gap:var(--s-2)">
      <h3>${project.name}</h3>
      ${project.status === 'archived' ? html`<span class="status">Archived</span>` : role ? roleTag(role) : ''}
    </div>
    <p>${project.description || 'No description yet.'}</p>
    <div class="project-meta">
      <span>${icon('users')}${plural(members, 'person', 'people')}</span>
      <span>${icon('globe')}${zoneLabel(project.timezone)} time</span>
      <span>${icon('calendar')}${formatDate(project.created_at)}</span>
    </div>
  </a>`;
}

await withLoading(page, listProjects, (projects) => {
  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');
  if (!projects.length) {
    render(
      page,
      html`<section class="card">${emptyState({
        iconName: 'folder-open',
        title: isAdmin ? 'No projects yet' : 'You are not in a project yet',
        body: isAdmin
          ? 'Create the first project, then invite people and make one of them its Team Leader.'
          : 'When someone invites you to a project, you get an email with a link to join.',
        action: isAdmin ? html`<button class="btn" type="button" data-new>${icon('plus')}New project</button>` : '',
      })}</section>`,
    );
    page.querySelector('[data-new]')?.addEventListener('click', () => actions.querySelector('#new-project').click());
    return;
  }
  render(
    page,
    html`<p class="muted">${isAdmin
        ? `${plural(active.length, 'active project')} on the platform.`
        : `You are in ${plural(projects.length, 'project')}.`}</p>
      <div class="grid-cards">${active.map(card)}</div>
      ${archived.length
        ? html`<details class="archived-group">
            <summary>${icon('archive')}Archived (${archived.length})</summary>
            <div class="grid-cards" style="margin-top:var(--s-4)">${archived.map(card)}</div>
          </details>`
        : ''}`,
  );
});
