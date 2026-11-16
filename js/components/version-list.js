// The trail of versions for one task, newest first, each with its review outcome.
import { html } from '../utils/dom.js';
import { formatDateTime, timeAgo } from '../utils/format.js';
import { feedbackNote, reviewStatus } from './ui.js';

const TONE = { approved: 'is-approved', revision_requested: 'is-revision', pending: 'is-pending' };

// hrefFor(version) makes each entry a link; without it entries are buttons with data-version-id.
export function versionList(versions, { currentId = null, hrefFor = null } = {}) {
  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  return html`<ol class="versions">
    ${newestFirst.map((v) => {
      const label = html`<span class="strong">Version ${v.version}</span>${v.id === currentId ? html` <span class="faint small">(showing)</span>` : ''}`;
      return html`<li class="version ${TONE[v.review_status] || ''}">
        <span class="version-dot">${v.version}</span>
        <div class="row row-wrap row-between">
          ${hrefFor
            ? html`<a href="${hrefFor(v)}">${label}</a>`
            : html`<button class="btn btn-ghost btn-sm" style="padding:0" type="button" data-version-id="${v.id}">${label}</button>`}
          ${reviewStatus(v.review_status)}
        </div>
        <p class="small faint" title="${formatDateTime(v.submitted_at)}">Submitted ${timeAgo(v.submitted_at)}</p>
        ${v.feedback ? html`<div style="margin-top:var(--s-2)">${feedbackNote({ feedback: v.feedback, reviewer: v.reviewer, when: v.reviewed_at })}</div>` : ''}
      </li>`;
    })}
  </ol>`;
}
