// app/admin/invitations.html: every invitation on the platform. Platform Admins can
// invite to any active project, send a link again or withdraw it.
import { mountApp } from '../components/layout.js';
import { openInviteDialog, resendWithDialog } from '../components/invite-dialog.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { emptyState, invitationStatus, withLoading } from '../components/ui.js';
import { effectiveStatus, listInvitations, revokeInvitation } from '../invitations/invitations.js';
import { listProjects } from '../projects/projects.js';
import { html, icon, on, render, setBusy } from '../utils/dom.js';
import { formatDate, formatDateTime, timeAgo } from '../utils/format.js';
import { url } from '../utils/paths.js';

const { page, actions } = await mountApp({
  active: 'invitations',
  title: 'Invitations',
  subtitle: 'Links work once, for one email address, for seven days.',
  need: 'admin',
});

const FILTERS = [
  ['pending', 'Pending'],
  ['accepted', 'Accepted'],
  ['expired', 'Expired'],
  ['revoked', 'Withdrawn'],
  ['all', 'All'],
];
let current = 'pending';
let list = [];

async function draw() {
  await withLoading(
    page,
    () => Promise.all([listInvitations(), listProjects()]),
    ([invitations, projects]) => {
      list = invitations;
      const active = projects.filter((p) => p.status === 'active');
      render(
        actions,
        active.length ? html`<button class="btn" type="button" id="invite">${icon('user-plus')}Invite someone</button>` : '',
      );
      actions.querySelector('#invite')?.addEventListener('click', () => openInviteDialog({ projects: active, onCreated: () => draw() }));
      paint();
    },
  );
}

function paint() {
  const shown = list.filter((inv) => current === 'all' || effectiveStatus(inv) === current);
  render(
    page,
    html`<div class="tabs" role="tablist" aria-label="Filter invitations">${FILTERS.map(([key, label]) => {
        const count = key === 'all' ? list.length : list.filter((inv) => effectiveStatus(inv) === key).length;
        return html`<button class="tab" type="button" role="tab" data-filter="${key}" aria-selected="${String(key === current)}">${label}<span class="tab-count">${count}</span></button>`;
      })}</div>
      <section class="card">
        ${shown.length
          ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Email</th><th>Project</th><th>Status</th><th>Invited</th><th>Expires</th><th><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>${shown.map((inv) => {
                const status = effectiveStatus(inv);
                const live = inv.project?.status === 'active';
                return html`<tr data-id="${inv.id}">
                  <td class="strong">${inv.email}</td>
                  <td><a href="${url('app/project.html', { id: inv.project_id, tab: 'invitations' })}">${inv.project?.name || 'Project'}</a></td>
                  <td>${invitationStatus(status)}</td>
                  <td title="${formatDateTime(inv.created_at)}">${timeAgo(inv.created_at)}<div class="small faint">by ${inv.inviter?.full_name || 'someone'}</div></td>
                  <td class="nowrap">${status === 'pending' ? formatDate(inv.expires_at) : html`<span class="faint">--</span>`}</td>
                  <td><div class="row" style="justify-content:flex-end;gap:var(--s-1)">
                    ${live && (status === 'pending' || status === 'expired') ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="resend">${icon('send')}Send again</button>` : ''}
                    ${live && status === 'pending' ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="revoke">Withdraw</button>` : ''}
                  </div></td>
                </tr>`;
              })}</tbody></table></div>`
          : emptyState({
              iconName: 'mail',
              title: current === 'pending' ? 'No pending invitations' : 'Nothing here',
              body: current === 'pending' ? 'Invite someone to a project and the invitation shows here until they accept.' : 'Try another filter.',
            })}
      </section>`,
  );
}

on(page, 'click', '[data-filter]', (event, button) => {
  current = button.dataset.filter;
  paint();
});

on(page, 'click', '[data-act]', async (event, button) => {
  const invitation = list.find((inv) => inv.id === button.closest('[data-id]').dataset.id);
  if (!invitation) return;
  if (button.dataset.act === 'revoke') {
    const yes = await confirmDialog({
      title: `Withdraw the invitation for ${invitation.email}?`,
      body: 'The link stops working straight away. You can invite them again later.',
      confirmLabel: 'Withdraw',
      danger: true,
    });
    if (!yes) return;
  }
  setBusy(button, true);
  try {
    if (button.dataset.act === 'revoke') {
      await revokeInvitation(invitation.id);
      toast('Invitation withdrawn');
    } else {
      await resendWithDialog(invitation);
    }
    await draw();
  } catch (error) {
    toastError(error);
    setBusy(button, false);
  }
});

await draw();
