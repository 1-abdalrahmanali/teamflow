// Small building blocks used on every page: people, statuses, empty and loading states.
import { html, icon, render } from '../utils/dom.js';
import { hueFor, initials, timeAgo } from '../utils/format.js';
import { INVITATION_STATUS, PRIORITY, REVIEW_STATUS, SUBMISSION_TYPES, TASK_STATUS } from '../utils/constants.js';

export function avatar(person, size = '') {
  const name = person?.full_name || 'Unknown';
  const sizeClass = size ? `avatar-${size}` : '';
  return html`<span class="avatar ${sizeClass}" data-hue="${hueFor(person?.id || name)}" title="${name}">${
    person?.avatar_url ? html`<img src="${person.avatar_url}" alt="">` : initials(name)
  }</span>`;
}

export function person(profile, meta = '') {
  if (!profile) return html`<span class="faint">Nobody yet</span>`;
  return html`<span class="person">${avatar(profile)}<span class="grow">
    <span class="person-name">${profile.full_name}</span>${meta ? html`<span class="person-meta">${meta}</span>` : ''}
  </span></span>`;
}

function badge(map, key) {
  const item = map[key] || { label: key, tone: '' };
  return html`<span class="status ${item.tone ? `status-${item.tone}` : ''}">${item.label}</span>`;
}
export const taskStatus = (status) => badge(TASK_STATUS, status);
export const reviewStatus = (status) => badge(REVIEW_STATUS, status);
export const invitationStatus = (status) => badge(INVITATION_STATUS, status);

export function priorityTag(priority) {
  const label = PRIORITY[priority]?.label || priority;
  return html`<span class="tag tag-${priority}">${icon('flag')}${label} priority</span>`;
}

export function typeTag(type) {
  const item = SUBMISSION_TYPES[type] || SUBMISSION_TYPES.code;
  return html`<span class="tag">${icon(item.icon)}${item.label}</span>`;
}

// An empty screen says what belongs here and, when possible, offers the next step.
export function emptyState({ iconName = 'inbox', title, body, action = '' }) {
  return html`<div class="empty">
    <div class="empty-icon">${icon(iconName)}</div>
    <h3>${title}</h3>
    <p>${body}</p>
    ${action}
  </div>`;
}

export function loading(lines = 4) {
  return html`<div class="card card-pad" aria-busy="true" aria-label="Loading">
    ${Array.from({ length: lines }, (_, i) => html`<div class="skeleton" style="width:${[92, 78, 85, 60, 70][i % 5]}%"></div>`)}
  </div>`;
}

export function errorState(message) {
  return html`<div class="card"><div class="empty">
    <div class="empty-icon" style="background:var(--red-wash);color:var(--red)">${icon('circle-alert')}</div>
    <h3>That did not load</h3>
    <p>${message}</p>
    <button class="btn btn-quiet" type="button" data-action="reload">Try again</button>
  </div></div>`;
}

// Reviewer feedback, shown as a note from a person rather than a system alert.
export function feedbackNote({ feedback, reviewer, when }) {
  if (!feedback) return '';
  return html`<div class="note">
    <div class="note-from">${reviewer ? avatar(reviewer, 'sm') : ''}<span>${reviewer?.full_name || 'Reviewer'} wrote${
      when ? html`, ${timeAgo(when)}` : ''
    }</span></div>
    <p class="note-text">${feedback}</p>
  </div>`;
}

// Wraps a page's first load: shows a skeleton, then the content or a readable error.
export async function withLoading(target, load, renderContent, { lines = 4 } = {}) {
  render(target, loading(lines));
  try {
    const data = await load();
    await renderContent(data);
  } catch (error) {
    render(target, errorState(error.message || 'Something went wrong.'));
    target.querySelector('[data-action="reload"]')?.addEventListener('click', () => window.location.reload());
  }
}
