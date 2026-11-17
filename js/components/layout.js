// The signed-in shell: a role-aware sidebar, the top bar and the content area.
// The sidebar shows only what this person can use. It is a convenience, not a lock:
// the database refuses anything a person is not allowed to do.
import { isConfigured, supabase } from '../config/supabase.js';
import { requireAccess } from '../auth/guards.js';
import { onSignedOut, signOut } from '../auth/auth.js';
import { forgetAccess } from '../auth/access.js';
import { $, html, icon, render } from '../utils/dom.js';
import { url } from '../utils/paths.js';
import { avatar } from './ui.js';

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

const MAX_PROJECT_LINKS = 6;

// The sections of the sidebar for this person. Keys are what pages pass as `active`.
export function navSections(access) {
  const sections = [];
  if (access.memberOfAny || !access.isAdmin) {
    sections.push({
      title: 'My work',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', path: 'app/dashboard.html' },
        { key: 'my-tasks', label: 'My tasks', icon: 'list-checks', path: 'app/tasks.html' },
        { key: 'my-submissions', label: 'My submissions', icon: 'history', path: 'app/submissions.html' },
      ],
    });
  }

  const projects = access.memberships.filter((m) => m.project);
  const projectItems = projects.slice(0, MAX_PROJECT_LINKS).map((m) => ({
    key: `project:${m.project_id}`,
    label: m.project.name,
    icon: m.project.status === 'archived' ? 'archive' : 'folder',
    path: `app/project.html?id=${m.project_id}`,
    tag: m.role === 'team_leader' ? 'Lead' : '',
  }));
  if (!access.isAdmin) {
    projectItems.push({
      key: 'projects',
      label: projects.length > MAX_PROJECT_LINKS ? `All ${projects.length} projects` : 'Project list',
      icon: 'folders',
      path: 'app/projects.html',
    });
  }
  if (projectItems.length) sections.push({ title: 'Projects', items: projectItems });

  if (access.leadsAny) {
    sections.push({
      title: 'Leading',
      items: [
        { key: 'leading', label: 'Team overview', icon: 'gauge', path: 'app/leading.html' },
        { key: 'review-queue', label: 'Review queue', icon: 'inbox', path: 'app/review-queue.html', count: 'reviews' },
      ],
    });
  }

  if (access.isAdmin) {
    const items = [
      { key: 'admin-overview', label: 'Platform overview', icon: 'chart-no-axes-column', path: 'app/admin/overview.html' },
      { key: 'projects', label: 'All projects', icon: 'folders', path: 'app/projects.html' },
      { key: 'users', label: 'Users and roles', icon: 'user-cog', path: 'app/admin/users.html' },
      { key: 'invitations', label: 'Invitations', icon: 'mail', path: 'app/admin/invitations.html' },
    ];
    if (!access.leadsAny) {
      items.splice(1, 0, { key: 'review-queue', label: 'Review queue', icon: 'inbox', path: 'app/review-queue.html', count: 'reviews' });
    }
    sections.push({ title: 'Admin', items });
  }
  return sections;
}

function roleLine(access) {
  if (access.isAdmin) return 'Platform Admin';
  if (access.leadsAny) return 'Team Leader';
  return 'Member';
}

const navLink = (item, active) => html`<a class="nav-link" data-key="${item.key}" href="${url(item.path)}" ${
  item.key === active ? html`aria-current="page"` : ''
}>${icon(item.icon)}<span class="nav-label">${item.label}</span>${
  item.tag ? html`<span class="nav-tag">${item.tag}</span>` : ''
}${item.count ? html`<span class="count" data-count="${item.count}" hidden></span>` : ''}</a>`;

// Mounts the shell. Resolves with the access model and the page containers.
// need: null (anyone signed in), 'manager' (Platform Admin or a Team Leader) or 'admin'.
export async function mountApp({ active, title, subtitle = '', need = null }) {
  const root = $('#app');
  if (!isConfigured) {
    render(root, notConfigured());
    return new Promise(() => {});
  }

  const access = await requireAccess({ need });
  const { profile } = access;
  const sections = navSections(access);

  render(
    root,
    html`<div class="app" id="shell">
      <a class="skip-link" href="#page">Skip to content</a>
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        ${brand(url('app/home.html'))}
        <nav class="nav">
          ${sections.map(
            (section) => html`<div class="nav-section">
              <p class="nav-heading">${section.title}</p>
              ${section.items.map((item) => navLink(item, active))}
            </div>`,
          )}
        </nav>
        <div class="sidebar-foot">
          <a class="user-chip" href="${url('app/settings.html')}" ${active === 'settings' ? html`aria-current="page"` : ''}>
            ${avatar(profile)}
            <span class="grow">
              <span class="person-name" style="display:block">${profile.full_name}</span>
              <span class="person-meta" style="display:block">${roleLine(access)}</span>
            </span>
            ${icon('settings')}
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
        <main class="page" id="page" tabindex="-1"></main>
      </div>
    </div>`,
  );
  document.title = `${title} - TeamFlow`;

  const shell = $('#shell');
  $('#menu-button').addEventListener('click', () => shell.classList.add('is-nav-open'));
  $('#nav-scrim').addEventListener('click', () => shell.classList.remove('is-nav-open'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') shell.classList.remove('is-nav-open');
  });
  let signingOut = false;
  $('#sign-out').addEventListener('click', async () => {
    signingOut = true;
    forgetAccess();
    await signOut();
    window.location.replace(url('login.html'));
  });
  // A session that ends anywhere else (expiry, another tab) sends this tab to sign-in,
  // with a note saying why. Signing out on purpose gets no such note.
  onSignedOut(() => {
    if (!signingOut) window.location.replace(url('login.html', { expired: 1 }));
  });

  showCounts(access);

  return {
    access,
    profile,
    page: $('#page'),
    actions: $('#page-actions'),
    // Highlights another sidebar link once the page knows where it belongs.
    setActive(key) {
      for (const link of document.querySelectorAll('.nav-link')) {
        if (link.dataset.key === key) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    },
    setTitle(nextTitle, nextSubtitle = '') {
      $('#page-title').textContent = nextTitle;
      $('#page-sub').textContent = nextSubtitle;
      document.title = `${nextTitle} - TeamFlow`;
    },
  };
}

// Small numbers beside the links that need attention: reviews waiting for this
// person, and their own tasks sent back for changes.
async function showCounts(access) {
  const put = (selector, count) => {
    for (const el of document.querySelectorAll(selector)) {
      el.textContent = String(count);
      el.hidden = !count;
    }
  };
  try {
    if (access.isManagerAnywhere) {
      const { count } = await supabase
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('review_status', 'pending')
        .neq('user_id', access.profile.id);
      put('[data-count="reviews"]', count || 0);
    }
    const { count: sentBack } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'revision_required')
      .eq('assigned_to', access.profile.id);
    if (sentBack) {
      const link = $('.nav-link[data-key="my-tasks"]');
      if (link && !link.querySelector('.count')) {
        link.insertAdjacentHTML('beforeend', `<span class="count count-red" title="Sent back for changes">${sentBack}</span>`);
      }
    }
  } catch {
    // The counts are a nicety; the page works without them.
  }
}

// A link back to a parent page, shown above the content.
export const backLink = (href, label) =>
  html`<a class="breadcrumb" href="${href}">${icon('arrow-left')}${label}</a>`;
