// admin/invitations.html: every invitation across the administrator's projects.
import { effectiveStatus, listInvitations, revokeInvitation } from '../invitations/invitations.js';
import { html, icon, on, render } from '../utils/dom.js';
import { formatDate, timeAgo } from '../utils/format.js';
import { mountApp } from '../components/layout.js';
import { emptyState, invitationStatus, loading } from '../components/ui.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { openInviteDialog } from '../components/invite-dialog.js';
import { ownedProjects, projectHref } from './admin-shared.js';

const { profile, page, actions } = await mountApp({
  area: 'admin',
  active: 'invitations',
  title: 'Invitations',
  subtitle: 'Links you have created. Each one works once, for one email, for 7 days.',
});

let projects = [];
let invitations = [];
let filter = 'pending';

async function load() {
  projects = await ownedProjects(profile);
  invitations = (await listInvitations()).filter((i) => projects.some((p) => p.id === i.project_id));
}

function draw() {
  const active = projects.filter((p) => p.status === 'active');
  render(actions, active.length ? html`<button class="btn" type="button" data-action="invite">${icon('user-plus')}Invite someone</button>` : '');

  const shown = invitations.filter((i) => filter === 'all' || effectiveStatus(i) === filter);
  const tab = (key, label) => html`<button class="tab" role="tab" type="button" data-filter="${key}" aria-selected="${filter === key}">${label}<span class="count">${
    key === 'all' ? invitations.length : invitations.filter((i) => effectiveStatus(i) === key).length
  }</span></button>`;

  render(
    page,
    html`<div class="tabs" role="tablist">${tab('pending', 'Pending')}${tab('accepted', 'Accepted')}${tab('expired', 'Expired')}${tab('revoked', 'Revoked')}${tab('all', 'All')}</div>
    ${shown.length
      ? html`<section class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>Email</th><th>Project</th><th>Status</th><th>Sent</th><th>Expires</th><th></th></tr></thead>
          <tbody>${shown.map((i) => {
            const status = effectiveStatus(i);
            return html`<tr>
              <td data-label="Email" class="strong">${i.email}</td>
              <td data-label="Project"><a href="${projectHref(i.project, 'members')}">${i.project?.name}</a></td>
              <td data-label="Status">${invitationStatus(status)}</td>
              <td data-label="Sent">${timeAgo(i.created_at)}</td>
              <td data-label="Expires">${status === 'pending' ? formatDate(i.expires_at) : ''}</td>
              <td class="cell-actions" data-label="">${status === 'pending' ? html`<button class="btn btn-ghost btn-sm" type="button" data-revoke="${i.id}">Revoke</button>` : ''}</td>
            </tr>`;
          })}</tbody>
        </table></div></section>`
      : html`<div class="card">${emptyState({
          iconName: 'mail',
          title: filter === 'pending' ? 'No invitations waiting' : 'Nothing here',
          body: active.length ? 'Invite someone to a project and send them the link it gives you.' : 'Create a project first, then invite people to it.',
          action: active.length && filter === 'pending' ? html`<button class="btn" type="button" data-action="invite">${icon('user-plus')}Invite someone</button>` : '',
        })}</div>`}`,
  );
}

async function refresh() {
  try {
    await load();
    draw();
  } catch (error) {
    toastError(error);
  }
}

on(document, 'click', '[data-action="invite"]', () =>
  openInviteDialog({ projects: projects.filter((p) => p.status === 'active'), onCreated: refresh }),
);
on(page, 'click', '[data-filter]', (event, button) => {
  filter = button.dataset.filter;
  draw();
});
on(page, 'click', '[data-revoke]', async (event, button) => {
  const invitation = invitations.find((i) => i.id === button.dataset.revoke);
  const ok = await confirmDialog({
    title: 'Revoke this invitation?',
    body: `The link sent to ${invitation.email} will stop working. You can invite them again afterwards.`,
    confirmLabel: 'Revoke invitation',
    danger: true,
  });
  if (!ok) return;
  try {
    await revokeInvitation(invitation.id);
    toast('Invitation revoked');
    await refresh();
  } catch (error) {
    toastError(error);
  }
});

render(page, loading(5));
try {
  await load();
  draw();
} catch (error) {
  toastError(error);
  render(page, html`<p class="form-message is-error">${error.message}</p>`);
}
