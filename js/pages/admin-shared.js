// Helpers used by several administrator pages.
import { listProjects } from '../projects/projects.js';
import { html, icon } from '../utils/dom.js';
import { deadlineInfo, timeAgo } from '../utils/format.js';
import { url } from '../utils/paths.js';
import { SUBMISSION_TYPES, languageLabel } from '../utils/constants.js';
import { person, priorityTag, reviewStatus, taskStatus } from '../components/ui.js';

// Projects this administrator owns. (They may also belong to other people's projects as a member.)
export async function ownedProjects(profile) {
  return (await listProjects()).filter((project) => project.owner_id === profile.id);
}

export const count = (embedded) => (Array.isArray(embedded) ? embedded[0]?.count ?? 0 : 0);

export const reviewHref = (submission) => url('admin/submission-review.html', { id: submission.id });
export const taskHref = (task) => url('admin/task-form.html', { id: task.id });
export const projectHref = (project, tab) => `${url('admin/project-details.html', { id: project.id })}${tab ? `#${tab}` : ''}`;

export function submissionKind(submission) {
  const type = submission.task?.submission_type;
  return type === 'code' ? languageLabel(submission.language) : SUBMISSION_TYPES[type]?.label || '';
}

// The table used on the review dashboard and the project workspace.
export function submissionsTable(submissions, { showProject = true } = {}) {
  return html`<div class="table-wrap"><table class="table">
    <thead><tr>
      <th>Task</th>${showProject ? html`<th>Project</th>` : ''}<th>Member</th><th>Version</th><th>Submitted</th><th>Type</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>
      ${submissions.map(
        (s) => html`<tr>
          <td data-label="Task"><a class="cell-title" href="${reviewHref(s)}">${s.task?.title || 'Deleted task'}</a></td>
          ${showProject ? html`<td data-label="Project">${s.task?.project?.name || ''}</td>` : ''}
          <td data-label="Member">${person(s.author)}</td>
          <td data-label="Version">${s.version}</td>
          <td data-label="Submitted" class="nowrap">${timeAgo(s.submitted_at)}</td>
          <td data-label="Type">${submissionKind(s)}</td>
          <td data-label="Status">${reviewStatus(s.review_status)}</td>
          <td class="cell-actions" data-label=""><a class="btn btn-sm ${s.review_status === 'pending' ? '' : 'btn-quiet'}" href="${reviewHref(s)}">${
            s.review_status === 'pending' ? 'Review' : 'Open'
          }</a></td>
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

export function taskRowsTable(tasks) {
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th>Task</th><th>Assigned to</th><th>Status</th><th>Priority</th><th>Deadline</th></tr></thead>
    <tbody>
      ${tasks.map((t) => {
        const due = deadlineInfo(t.deadline, t.status);
        return html`<tr>
          <td data-label="Task"><a class="cell-title" href="${taskHref(t)}">${t.title}</a>
            <div class="tiny faint">${SUBMISSION_TYPES[t.submission_type]?.label}${t.submission_type === 'code' && t.programming_language ? `, ${languageLabel(t.programming_language)}` : ''}</div></td>
          <td data-label="Assigned to">${person(t.assignee)}</td>
          <td data-label="Status">${taskStatus(t.status)}</td>
          <td data-label="Priority">${priorityTag(t.priority)}</td>
          <td data-label="Deadline" class="${due.tone ? `due-${due.tone}` : ''} nowrap">${due.label}</td>
        </tr>`;
      })}
    </tbody>
  </table></div>`;
}

export const newProjectButton = () => html`<button class="btn" type="button" data-action="new-project">${icon('plus')}New project</button>`;
