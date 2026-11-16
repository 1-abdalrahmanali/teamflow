// The signed-in shell: sidebar, top bar and the content area every app page renders into.
import { isConfigured, supabase } from '../config/supabase.js';
import { requireProfile } from '../auth/guard.js';
import { onSignedOut, signOut } from '../auth/auth.js';
import { $, html, icon, render } from '../utils/dom.js';
import { url } from '../utils/paths.js';
import { avatar } from './ui.js';

const ADMIN_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', path: 'admin/dashboard.html' },
  { key: 'projects', label: 'My projects', icon: 'folder-kanban', path: 'admin/projects.html' },
  { key: 'members', label: 'Team members', icon: 'users', path: 'admin/members.html' },
  { key: 'invitations', label: 'Invitations', icon: 'mail', path: 'admin/invitations.html' },
  { key: 'submissions', label: 'Submissions', icon: 'inbox', path: 'admin/submissions.html' },
  { key: 'settings', label: 'Settings', icon: 'settings', path: 'settings.html' },
];

const MEMBER_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', path: 'member/dashboard.html' },
  { key: 'projects', label: 'My projects', icon: 'folder-kanban', path: 'member/projects.html' },
  { key: 'tasks', label: 'My tasks', icon: 'list-checks', path: 'member/tasks.html' },
  { key: 'submissions', label: 'Submissions', icon: 'history', path: 'member/submissions.html' },
  { key: 'settings', label: 'Settings', icon: 'settings', path: 'settings.html' },
];

export const brand = (href = url('index.html')) =>
  html`<a class="brand" href="${href}"><span class="brand-mark">${icon('layers')}</span>TeamFlow</a>`;

// Shown on any page while js/config/env.js still holds the placeholders.
export function notConfigured() {
  return html`<div class="auth-shell"><div class="auth-card card card-pad">
    ${brand()}
    <h1>One step left</h1>
    <p class="muted" style="margin-top:8px">TeamFlow is not connected to a Supabase project yet. Open
      <code>js/config/env.js</code> and paste in the project URL and the publishable key. The README lists the steps.</p>
  </div></div>`;
}

// Mounts the shell and resolves with the signed-in profile and the page containers.
// area: 'admin' (administrators only), 'member', or 'shared' (navigation follows the person's role).
export async function mountApp({ area = 'shared', active, title, subtitle = '' }) {
  const root = $('#app');
  if (!isConfigured) {
    render(root, notConfigured());
    return new Promise(() => {});
  }

  const profile = await requireProfile({ adminOnly: area === 'admin' });
  const isAdmin = profile.platform_role === 'administrator';
  const adminNav = area === 'admin' || (area === 'shared' && isAdmin);
  const nav = adminNav ? ADMIN_NAV : MEMBER_NAV;

  // An administrator can also be a member of someone else's project; this link switches views.
  const viewSwitch = isAdmin
    ? html`<a class="nav-link" href="${url(adminNav ? 'member/dashboard.html' : 'admin/dashboard.html')}">
        ${icon('repeat')}<span>${adminNav ? 'Projects I joined' : 'Back to admin view'}</span></a>`
    : '';

  render(
    root,
    html`<div class="app" id="shell">
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        ${brand(url(nav[0].path))}
        <nav class="nav">
          ${nav.map(
            (item) => html`<a class="nav-link" data-key="${item.key}" href="${url(item.path)}" ${
              item.key === active ? html`aria-current="page"` : ''
            }>${icon(item.icon)}<span>${item.label}</span></a>`,
          )}
        </nav>
        <div class="sidebar-foot">
          ${viewSwitch}
          <a class="user-chip" href="${url('settings.html')}">
            ${avatar(profile)}
            <span class="grow">
              <span class="person-name" style="display:block">${profile.full_name}</span>
              <span class="person-meta" style="display:block">${isAdmin ? 'Administrator' : 'Member'}</span>
            </span>
          </a>
          <button class="btn btn-ghost btn-block" type="button" id="sign-out" style="justify-content:flex-start">
            ${icon('log-out')}Sign out
          </button>
        </div>
      </aside>
      <button class="nav-scrim" type="button" id="nav-scrim" aria-label="Close menu"></button>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-quiet btn-icon menu-button" type="button" id="menu-button" aria-label="Open menu">${icon('menu')}</button>
          <div class="topbar-titles">
            <h1 id="page-title">${title}</h1>
            <p class="topbar-sub" id="page-sub">${subtitle}</p>
          </div>
          <div class="topbar-actions" id="page-actions"></div>
        </header>
        <main class="page" id="page"></main>
      </div>
    </div>`,
  );
  document.title = `${title} - TeamFlow`;

  const shell = $('#shell');
  $('#menu-button').addEventListener('click', () => shell.classList.add('is-nav-open'));
  $('#nav-scrim').addEventListener('click', () => shell.classList.remove('is-nav-open'));
  let signingOut = false;
  $('#sign-out').addEventListener('click', async () => {
    signingOut = true;
    await signOut();
    window.location.replace(url('login.html'));
  });
  // A session that ends anywhere else (expiry, another tab) sends this tab to sign-in,
  // with a note saying why. Signing out on purpose gets no such note.
  onSignedOut(() => {
    if (!signingOut) window.location.replace(url('login.html', { expired: 1 }));
  });

  showNavCount(adminNav, profile.id);

  return {
    profile,
    page: $('#page'),
    actions: $('#page-actions'),
    setTitle(nextTitle, nextSubtitle = '') {
      $('#page-title').textContent = nextTitle;
      $('#page-sub').textContent = nextSubtitle;
      document.title = `${nextTitle} - TeamFlow`;
    },
  };
}

// A small number beside the link that most needs attention:
// reviews waiting (administrator) or tasks sent back for changes (member).
async function showNavCount(adminNav, userId) {
  try {
    const query = adminNav
      ? supabase
          .from('submissions')
          .select('id', { count: 'exact', head: true })
          .eq('review_status', 'pending')
          .neq('user_id', userId)
      : supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'revision_required')
          .eq('assigned_to', userId);
    const { count } = await query;
    if (!count) return;
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = String(count);
    $(`.nav-link[data-key="${adminNav ? 'submissions' : 'tasks'}"]`)?.append(badge);
  } catch {
    // The count is a nicety; the page works without it.
  }
}

// A link back to a parent page, shown above the content.
export const backLink = (href, label) =>
  html`<a class="breadcrumb" href="${href}">${icon('arrow-left')}${label}</a>`;
