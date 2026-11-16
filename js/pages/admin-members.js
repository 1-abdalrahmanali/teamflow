// admin/members.html: everyone across the administrator's projects.
import { listMembers } from '../members/members.js';
import { html, icon, on, render } from '../utils/dom.js';
import { formatDate, plural } from '../utils/format.js';
import { mountApp } from '../components/layout.js';
import { emptyState, person, withLoading } from '../components/ui.js';
import { openInviteDialog } from '../components/invite-dialog.js';
import { ownedProjects, projectHref } from './admin-shared.js';

const { profile, page, actions } = await mountApp({
  area: 'admin',
  active: 'members',
  title: 'Team members',
  subtitle: 'Everyone who has joined one of your projects.',
});

await withLoading(
  page,
  async () => {
    const projects = await ownedProjects(profile);
    const memberships = (await listMembers()).filter(
      (m) => m.user_id !== profile.id && projects.some((p) => p.id === m.project_id),
    );
    return { projects, memberships };
  },
  ({ projects, memberships }) => {
    const active = projects.filter((p) => p.status === 'active');
    render(actions, active.length ? html`<button class="btn" type="button" data-action="invite">${icon('user-plus')}Invite someone</button>` : '');
    on(document, 'click', '[data-action="invite"]', () =>
      openInviteDialog({ projects: active, onCreated: () => {} }),
    );

    // One row per person, listing every project they are in.
    const people = new Map();
    for (const m of memberships) {
      const entry = people.get(m.user_id) || { user: m.user, projects: [], since: m.joined_at };
      entry.projects.push(m.project);
      if (m.joined_at < entry.since) entry.since = m.joined_at;
      people.set(m.user_id, entry);
    }
    const rows = [...people.values()].sort((a, b) => (a.user?.full_name || '').localeCompare(b.user?.full_name || ''));

    render(
      page,
      rows.length
        ? html`<section class="card">
            <div class="card-head"><h3>${plural(rows.length, 'person', 'people')}</h3>
              <span class="small faint">Remove someone from a project in that project's Members tab.</span></div>
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Person</th><th>Projects</th><th>Member since</th></tr></thead>
              <tbody>${rows.map(
                (r) => html`<tr>
                  <td data-label="Person">${person(r.user, r.user?.email)}</td>
                  <td data-label="Projects"><div class="row row-wrap" style="gap:6px">${r.projects.map(
                    (p) => html`<a class="tag" href="${projectHref(p, 'members')}">${p.name}</a>`,
                  )}</div></td>
                  <td data-label="Member since">${formatDate(r.since)}</td>
                </tr>`,
              )}</tbody>
            </table></div>
          </section>`
        : html`<div class="card">${emptyState({
            iconName: 'users',
            title: 'No team members yet',
            body: active.length
              ? 'Invite someone to a project. You will get a link to send them, and they appear here once they join.'
              : 'Create a project first, then invite people to it.',
            action: active.length ? html`<button class="btn" type="button" data-action="invite">${icon('user-plus')}Invite someone</button>` : '',
          })}</div>`,
    );
  },
);
