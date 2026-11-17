// One task as a row in a list, linking to the task page.
import { html, icon } from '../utils/dom.js';
import { url } from '../utils/paths.js';
import { blockedTag, deadlineTag, priorityTag, taskStatus } from './ui.js';
import { avatar } from './ui.js';

// options: blocked (bool), showProject, showAssignee.
export function taskRow(task, { blocked = false, showProject = false, showAssignee = false } = {}) {
  const zone = task.project?.timezone || 'UTC';
  return html`<a class="task-row ${blocked ? 'is-blocked' : ''}" href="${url('app/task.html', { id: task.id })}">
    ${showAssignee
      ? task.assignee
        ? avatar(task.assignee)
        : html`<span class="avatar avatar-empty" title="Not assigned">${icon('user-round')}</span>`
      : ''}
    <div class="grow" style="min-width:0">
      <p class="task-row-title">${task.title}</p>
      <div class="task-row-meta">
        ${showProject && task.project ? html`<span>${icon('folder')}${task.project.name}</span>` : ''}
        ${showAssignee ? html`<span>${task.assignee?.full_name || 'Not assigned yet'}</span>` : ''}
        ${deadlineTag(task, zone)}
        ${task.priority === 'high' ? priorityTag('high') : ''}
      </div>
    </div>
    <div class="task-row-end">
      ${blocked && task.status === 'todo' ? blockedTag() : ''}
      ${taskStatus(task.status)}
    </div>
  </a>`;
}
