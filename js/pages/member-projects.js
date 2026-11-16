// member/projects.html
import { listTasks } from '../tasks/tasks.js';
import { html, icon, render } from '../utils/dom.js';
import { plural } from '../utils/format.js';
import { mountApp } from '../components/layout.js';
import { emptyState, withLoading } from '../components/ui.js';
import { joinedProjects, ownerLine, projectHref } from './member-shared.js';

const { profile, page } = await mountApp({
  area: 'member',
  active: 'projects',
  title: 'My projects',
  subtitle: 'The projects you have been invited to.',
});

await withLoading(
  page,
  async () => {
    const [projects, tasks] = await Promise.all([joinedProjects(profile), listTasks({ assignedTo: profile.id })]);
    return { projects, tasks };
  },
  ({ projects, tasks }) => {
    if (!projects.length) {
      render(
        page,
        html`<div class="card">${emptyState({
          iconName: 'folder-open',
          title: 'No projects yet',
          body: 'Projects appear here after you accept an invitation. Ask your project owner to send you a link.',
        })}</div>`,
      );
      return;
    }
    render(
      page,
      html`<div class="grid-cards">${projects.map((p) => {
        const mine = tasks.filter((t) => t.project_id === p.id);
        const open = mine.filter((t) => t.status !== 'completed').length;
        return html`<a class="card project-card" href="${projectHref(p)}">
          <div class="row row-between"><h3>${p.name}</h3>${p.status === 'archived' ? html`<span class="status">Archived</span>` : ''}</div>
          <p>${p.description || 'No description yet.'}</p>
          <div style="margin-top:var(--s-3)">${ownerLine(p)}</div>
          <div class="project-meta">
            <span>${icon('list-checks')}${plural(open, 'open task')}</span>
            <span>${icon('circle-check')}${mine.length - open} done</span>
          </div>
        </a>`;
      })}</div>`,
    );
  },
);
