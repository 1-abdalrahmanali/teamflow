// admin/submissions.html: the review dashboard.
import { listSubmissions } from '../submissions/submissions.js';
import { html, on, render } from '../utils/dom.js';
import { mountApp } from '../components/layout.js';
import { emptyState, withLoading } from '../components/ui.js';
import { ownedProjects, submissionsTable } from './admin-shared.js';

const { profile, page } = await mountApp({
  area: 'admin',
  active: 'submissions',
  title: 'Submissions',
  subtitle: 'Every version your members have handed in. Oldest waiting work is at the bottom of the queue.',
});

let filter = 'pending';
let projectFilter = '';

await withLoading(
  page,
  async () => {
    const projects = await ownedProjects(profile);
    // Only work in projects this administrator owns: their own submissions elsewhere are not theirs to review.
    const submissions = (await listSubmissions()).filter((s) => s.task?.project?.owner_id === profile.id);
    return { projects, submissions };
  },
  ({ projects, submissions }) => {
    const draw = () => {
      const inProject = projectFilter ? submissions.filter((s) => s.task?.project_id === projectFilter) : submissions;
      let shown = filter === 'pending' ? inProject.filter((s) => s.review_status === 'pending') : inProject;
      // The queue reads oldest first, so nobody waits longest by accident.
      if (filter === 'pending') shown = [...shown].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
      const waiting = inProject.filter((s) => s.review_status === 'pending').length;

      render(
        page,
        html`<div class="row row-wrap row-between">
          <div class="tabs" role="tablist" style="flex:1">
            <button class="tab" role="tab" type="button" data-filter="pending" aria-selected="${filter === 'pending'}">Waiting for review<span class="count">${waiting}</span></button>
            <button class="tab" role="tab" type="button" data-filter="all" aria-selected="${filter === 'all'}">All versions<span class="count">${inProject.length}</span></button>
          </div>
          ${projects.length > 1
            ? html`<label class="row small"><span class="faint">Project</span>
                <select class="select" data-project-filter style="min-height:34px;width:auto">
                  <option value="">All projects</option>
                  ${projects.map((p) => html`<option value="${p.id}" ${projectFilter === p.id ? 'selected' : ''}>${p.name}</option>`)}
                </select></label>`
            : ''}
        </div>
        ${shown.length
          ? html`<section class="card">${submissionsTable(shown)}</section>`
          : html`<div class="card">${
              filter === 'pending'
                ? emptyState({ iconName: 'coffee', title: 'You are all caught up', body: 'Nothing is waiting for review. New submissions appear here the moment they are sent.' })
                : emptyState({ iconName: 'inbox', title: 'No submissions yet', body: 'Once members hand in work, every version is listed here.' })
            }</div>`}`,
      );
    };
    on(page, 'click', '[data-filter]', (event, button) => {
      filter = button.dataset.filter;
      draw();
    });
    on(page, 'change', '[data-project-filter]', (event, select) => {
      projectFilter = select.value;
      draw();
    });
    draw();
  },
);
