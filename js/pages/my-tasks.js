// app/tasks.html: every task assigned to me, across projects, filtered by status.
import { mountApp } from '../components/layout.js';
import { emptyState, withLoading } from '../components/ui.js';
import { taskRow } from '../components/task-row.js';
import { blockedTaskIds, listTasks } from '../tasks/tasks.js';
import { html, on, render } from '../utils/dom.js';
import { param } from '../utils/paths.js';

const { profile, page } = await mountApp({
  active: 'my-tasks',
  title: 'My tasks',
  subtitle: 'Everything assigned to you, soonest deadline first.',
});

const FILTERS = [
  { key: 'open', label: 'Open', test: (t) => t.status !== 'completed' },
  { key: 'revision_required', label: 'Needs changes', test: (t) => t.status === 'revision_required' },
  { key: 'submitted', label: 'Waiting for review', test: (t) => t.status === 'submitted' },
  { key: 'completed', label: 'Completed', test: (t) => t.status === 'completed' },
  { key: 'all', label: 'All', test: () => true },
];

await withLoading(
  page,
  async () => {
    const tasks = await listTasks({ assignedTo: profile.id });
    const blocked = await blockedTaskIds(tasks.filter((t) => t.status === 'todo').map((t) => t.id));
    return { tasks, blocked };
  },
  ({ tasks, blocked }) => {
    let current = FILTERS.some((f) => f.key === param('show')) ? param('show') : 'open';

    function draw() {
      const filter = FILTERS.find((f) => f.key === current);
      const shown = tasks.filter(filter.test);
      render(
        page,
        html`<div class="tabs" role="tablist" aria-label="Filter tasks">
            ${FILTERS.map((f) => {
              const count = tasks.filter(f.test).length;
              return html`<button class="tab" type="button" role="tab" data-filter="${f.key}" aria-selected="${String(f.key === current)}">
                ${f.label}<span class="tab-count">${count}</span></button>`;
            })}
          </div>
          <section class="card">
            ${shown.length
              ? html`<div>${shown.map((t) => taskRow(t, { blocked: blocked.has(t.id), showProject: true }))}</div>`
              : emptyState({
                  iconName: current === 'open' ? 'party-popper' : 'inbox',
                  title: current === 'open' ? (tasks.length ? 'Nothing open' : 'No tasks yet') : 'Nothing here',
                  body: tasks.length
                    ? 'Try another filter to see the rest of your tasks.'
                    : 'When a Team Leader assigns you a task, it shows up here.',
                })}
          </section>`,
      );
    }

    on(page, 'click', '[data-filter]', (event, button) => {
      current = button.dataset.filter;
      const next = new URL(window.location.href);
      next.searchParams.set('show', current);
      history.replaceState(null, '', next);
      draw();
    });
    draw();
  },
);
