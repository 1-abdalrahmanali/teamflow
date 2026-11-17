// The trail of versions for one task, newest first, each with its review outcome,
// score and feedback.
import { html, icon } from '../utils/dom.js';
import { formatDateTime, timeAgo } from '../utils/format.js';
import { feedbackNote, reviewStatus, scoreBadge } from './ui.js';

const TONE = { approved: 'is-approved', revision_requested: 'is-revision', pending: 'is-pending' };

// hrefFor(version) makes each entry a link; without it entries are buttons with data-version-id.
export function versionList(versions, { currentId = null, hrefFor = null } = {}) {
  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  return html`<ol class="versions">
    ${newestFirst.map((v) => {
      const label = html`<span class="strong">Version ${v.version}</span>${
        v.id === currentId ? html` <span class="faint small">(showing)</span>` : ''
      }`;
      const review = v.review;
      return html`<li class="version ${TONE[v.review_status] || ''}">
        <span class="version-dot">${v.version}</span>
        <div class="row row-wrap row-between">
          ${hrefFor
            ? html`<a href="${hrefFor(v)}">${label}</a>`
            : html`<button class="btn btn-ghost btn-sm" style="padding:0" type="button" data-version-id="${v.id}">${label}</button>`}
          <span class="row" style="gap:var(--s-2)">${review?.score != null ? scoreBadge(review.score) : ''}${reviewStatus(v.review_status)}</span>
        </div>
        <p class="small faint" title="${formatDateTime(v.submitted_at)}">Submitted ${timeAgo(v.submitted_at)}${
          review ? html`, reviewed ${timeAgo(review.created_at)}` : ''
        }</p>
        ${review?.feedback
          ? html`<div style="margin-top:var(--s-2)">${feedbackNote({ feedback: review.feedback, reviewer: review.reviewer, when: review.created_at })}</div>`
          : review?.review_action === 'approved'
            ? html`<p class="small faint" style="margin-top:var(--s-1)">${icon('badge-check')} Approved without written feedback.</p>`
            : ''}
      </li>`;
    })}
  </ol>`;
}
