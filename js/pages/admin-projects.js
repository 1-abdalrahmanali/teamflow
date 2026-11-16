// admin/projects.html
import { html, icon, on, render } from '../utils/dom.js';
import { formatDate, plural } from '../utils/format.js';
import { mountApp } from '../components/layout.js';
import { emptyState, withLoading } from '../components/ui.js';
import { openProjectDialog } from '../components/project-dialog.js';
import { count, newProjectButton, ownedProjects, projectHref } from './admin-shared.js';

const { profile, page, actions } = await mountApp({
  area: 'admin',
  active: 'projects',
  title: 'My projects',
  subtitle: 'Each project has its own tasks, members and reviews.',
});
render(actions, newProjectButton());
on(document, 'click', '[data-action="new-project"]', () =>
  openProjectDialog({ onSaved: (project) => window.location.assign(projectHref(project)) }),
);

let filter = 'active';

function projectCard(project) {
  const members = Math.max(count(project.project_members) - 1, 0); // the owner is not counted as a member
  return html`<a class="card project-card" href="${projectHref(project)}">
    <div class="row row-between"><h3>${project.name}</h3>
      ${project.status === 'archived' ? html`<span class="status">Archived</span>` : ''}</div>
    <p>${project.description || 'No description yet.'}</p>
    <div class="project-meta">
      <span>${icon('list-checks')}${plural(count(project.tasks), 'task')}</span>
      <span>${icon('users')}${plural(members, 'member')}</span>
      <span>${icon('calendar-days')}${formatDate(project.created_at)}</span>
    </div>
  </a>`;
}

await withLoading(page, () => ownedProjects(profile), (projects) => {
  const draw = () => {
    const shown = projects.filter((p) => filter === 'all' || p.status === filter);
    const tab = (key, label) => html`<button class="tab" role="tab" type="button" data-filter="${key}" aria-selected="${filter === key}">
      ${label}<span class="count">${key === 'all' ? projects.length : projects.filter((p) => p.status === key).length}</span></button>`;
    render(
      page,
      html`<div class="tabs" role="tablist">${tab('active', 'Active')}${tab('archived', 'Archived')}${tab('all', 'All')}</div>
      ${shown.length
        ? html`<div class="grid-cards">${shown.map(projectCard)}</div>`
        : html`<div class="card">${
            projects.length
              ? emptyState({ iconName: 'archive', title: `No ${filter} projects`, body: 'Switch tabs to see the rest.' })
              : emptyState({
                  iconName: 'folder-kanban',
                  title: 'No projects yet',
                  body: 'Create a project, then invite the people who will work on it.',
                  action: newProjectButton(),
                })
          }</div>`}`,
    );
  };
  on(page, 'click', '[data-filter]', (event, button) => {
    filter = button.dataset.filter;
    draw();
  });
  draw();
});
