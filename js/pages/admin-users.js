// app/admin/users.html: everyone on the platform and their roles. Platform Admins
// promote and demote here; every change is written to the activity log.
import { mountApp } from '../components/layout.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { avatar, emptyState, roleTag, withLoading } from '../components/ui.js';
import { listRoleChanges, listUsers, setPlatformRole } from '../users/users.js';
import { describeActivity } from '../projects/projects.js';
import { html, icon, on, render, setBusy } from '../utils/dom.js';
import { formatDate, formatDateTime, plural, timeAgo } from '../utils/format.js';
import { url } from '../utils/paths.js';

const { profile, page } = await mountApp({
  active: 'users',
  title: 'Users and roles',
  subtitle: 'Platform Admins manage everything. Team Leaders are chosen per project, in its People tab.',
  need: 'admin',
});

let query = '';

async function draw() {
  await withLoading(
    page,
    () => Promise.all([listUsers(), listRoleChanges(12)]),
    ([users, changes]) => {
      const admins = users.filter((u) => u.platform_role === 'platform_admin').length;
      function drawTable() {
        const q = query.trim().toLowerCase();
        const shown = q ? users.filter((u) => `${u.full_name} ${u.email}`.toLowerCase().includes(q)) : users;
        render(
          page.querySelector('#user-table'),
          shown.length
            ? html`<div class="table-wrap"><table class="table">
                <thead><tr><th>Person</th><th>Platform role</th><th>Projects</th><th>Joined</th><th><span class="sr-only">Actions</span></th></tr></thead>
                <tbody>${shown.map((u) => {
                  const self = u.id === profile.id;
                  const isAdmin = u.platform_role === 'platform_admin';
                  const memberships = u.memberships || [];
                  return html`<tr data-id="${u.id}" data-name="${u.full_name}" data-role="${u.platform_role}">
                    <td><span class="person">${avatar(u)}<span class="grow"><span class="person-name">${u.full_name}${self ? ' (you)' : ''}</span>
                      <span class="person-meta">${u.email}</span></span></span></td>
                    <td>${isAdmin ? roleTag('platform_admin') : html`<span class="role-tag">User</span>`}</td>
                    <td>${memberships.length
                      ? html`<div class="chip-list">${memberships.map(
                          (m) => html`<a class="chip ${m.role === 'team_leader' ? 'chip-lead' : ''}" href="${url('app/project.html', { id: m.project?.id, tab: 'members' })}">${m.role === 'team_leader' ? icon('crown') : ''}${m.project?.name || 'Project'}</a>`,
                        )}</div>`
                      : html`<span class="faint small">None</span>`}</td>
                    <td class="nowrap">${formatDate(u.created_at)}</td>
                    <td>${self
                      ? html`<span class="small faint" title="Ask another Platform Admin to change your role">Your own role</span>`
                      : isAdmin
                        ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="demote">Remove admin</button>`
                        : html`<button class="btn btn-quiet btn-sm" type="button" data-act="promote">${icon('shield-check')}Make Platform Admin</button>`}</td>
                  </tr>`;
                })}</tbody></table></div>`
            : emptyState({ iconName: 'search-x', title: 'Nobody matches', body: 'Check the spelling, or search by email instead.' }),
        );
      }

      render(
        page,
        html`<div class="filters">
            <label class="field field-inline grow"><span class="sr-only">Search people</span>
              <input class="input" type="search" id="user-search" placeholder="Search by name or email" value="${query}"></label>
            <p class="small muted">${plural(users.length, 'person', 'people')}, ${plural(admins, 'Platform Admin')}.</p>
          </div>
          <section class="card" id="user-table"></section>
          <section class="card">
            <div class="card-head"><h2 class="section-title">${icon('scroll-text')}Role changes</h2><span class="small faint">Newest first</span></div>
            <div class="card-body">
              ${changes.length
                ? html`<ul class="feed">${changes.map(
                    (c) => html`<li>${avatar(c.actor || { full_name: '?' }, 'sm')}<span class="grow"><strong>${c.actor?.full_name || 'Someone'}</strong> ${describeActivity(c)}${
                      c.project ? html` <span class="faint">in ${c.project.name}</span>` : ''
                    }</span><time title="${formatDateTime(c.created_at)}">${timeAgo(c.created_at)}</time></li>`,
                  )}</ul>`
                : html`<p class="muted small">No role changes yet.</p>`}
            </div>
          </section>`,
      );
      page.querySelector('#user-search').addEventListener('input', (event) => {
        query = event.target.value;
        drawTable();
      });
      drawTable();
    },
  );
}

on(page, 'click', '[data-act]', async (event, button) => {
  const row = button.closest('[data-id]');
  const name = row.dataset.name;
  const promote = button.dataset.act === 'promote';
  const yes = await confirmDialog({
    title: promote ? `Make ${name} a Platform Admin?` : `Remove ${name} as a Platform Admin?`,
    body: promote
      ? 'They will be able to see and manage every project, change roles and review any work. The change is recorded.'
      : 'They keep the projects they belong to, with the same project roles, but lose access to everything else.',
    confirmLabel: promote ? 'Make Platform Admin' : 'Remove admin',
    danger: !promote,
  });
  if (!yes) return;
  setBusy(button, true);
  try {
    await setPlatformRole(row.dataset.id, promote ? 'platform_admin' : 'user');
    toast(promote ? `${name} is now a Platform Admin` : `${name} is no longer a Platform Admin`);
    await draw();
  } catch (error) {
    toastError(error);
    setBusy(button, false);
  }
});

await draw();
