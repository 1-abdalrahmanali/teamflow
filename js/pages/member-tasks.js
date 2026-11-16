// member/tasks.html
import { listTasks } from '../tasks/tasks.js';
import { html, on, render } from '../utils/dom.js';
import { mountApp } from '../components/layout.js';
import { emptyState, withLoading } from '../components/ui.js';
import { sortTasks, taskRow } from './member-shared.js';

const { profile, page } = await mountApp({
  area: 'member',
  active: 'tasks',
  title: 'My tasks',
  subtitle: 'Everything assigned to you, with the most urgent first.',
});

const FILTERS = [
  ['open', 'To work on', (t) => ['todo', 'in_progress', 'revision_required'].includes(t.status)],
  ['submitted', 'Waiting for review', (t) => t.status === 'submitted'],
  ['completed', 'Completed', (t) => t.status === 'completed'],
  ['all', 'All', () => true],
];
let filter = 'open';

await withLoading(
  page,
  () => listTasks({ assignedTo: profile.id }),
  (tasks) => {
    const draw = () => {
      const [, , test] = FILTERS.find(([key]) => key === filter);
      const shown = sortTasks(tasks.filter(test));
      render(
        page,
        html`<div class="tabs" role="tablist">${FILTERS.map(
          ([key, label, match]) => html`<button class="tab" role="tab" type="button" data-filter="${key}" aria-selected="${filter === key}">${label}<span class="count">${tasks.filter(match).length}</span></button>`,
        )}</div>
        <section class="card">${shown.length
          ? shown.map((t) => taskRow(t))
          : emptyState(
              tasks.length
                ? { iconName: 'circle-check', title: 'Nothing in this list', body: 'Check the other tabs for the rest of your tasks.' }
                : { iconName: 'list-checks', title: 'No tasks yet', body: 'When a project owner assigns you a task, it appears here.' },
            )}</section>`,
      );
    };
    on(page, 'click', '[data-filter]', (event, button) => {
      filter = button.dataset.filter;
      draw();
    });
    draw();
  },
);
