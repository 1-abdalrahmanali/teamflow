// Helpers used by several member pages.
import { listProjects } from '../projects/projects.js';
import { html } from '../utils/dom.js';
import { deadlineInfo } from '../utils/format.js';
import { url } from '../utils/paths.js';
import { SUBMISSION_TYPES } from '../utils/constants.js';
import { avatar, priorityTag, taskStatus } from '../components/ui.js';

// Projects this person joined as a member (an administrator's own projects live in the admin view).
export async function joinedProjects(profile) {
  return (await listProjects()).filter((project) => project.owner_id !== profile.id);
}

export const taskHref = (task) => url('member/task-details.html', { id: task.id });
export const projectHref = (project) => url('member/project-details.html', { id: project.id });

// Open work first, soonest deadline first; finished work last.
export function sortTasks(tasks) {
  const rank = { revision_required: 0, in_progress: 1, todo: 2, submitted: 3, completed: 4 };
  return [...tasks].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const da = a.deadline ? Date.parse(a.deadline) : Infinity;
    const db = b.deadline ? Date.parse(b.deadline) : Infinity;
    return da - db;
  });
}

export function taskRow(task, { showProject = true } = {}) {
  const due = deadlineInfo(task.deadline, task.status);
  return html`<a class="task-row" href="${taskHref(task)}">
    <div class="grow">
      <div class="task-row-title">${task.title}</div>
      <div class="task-row-meta">
        ${showProject ? html`<span>${task.project?.name}</span>` : ''}
        <span>${SUBMISSION_TYPES[task.submission_type]?.label}</span>
        <span class="${due.tone ? `due-${due.tone}` : ''}">${due.label}</span>
      </div>
    </div>
    <div class="row row-wrap" style="justify-content:flex-end">${task.priority === 'high' ? priorityTag('high') : ''}${taskStatus(task.status)}</div>
  </a>`;
}

export function ownerLine(project) {
  return html`<span class="person">${avatar(project.owner, 'sm')}<span class="small muted">Run by ${project.owner?.full_name || 'the project owner'}</span></span>`;
}
