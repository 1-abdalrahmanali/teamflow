// accept-invitation.html#token=...
// The token arrives in the URL fragment, which is never sent to a server. It is
// kept in this browser while the person signs in or signs up, then used once.
import { getCurrentProfile, getSession, signOut } from '../auth/auth.js';
import { forgetAccess } from '../auth/access.js';
import { $, html, setBusy } from '../utils/dom.js';
import { formatDate } from '../utils/format.js';
import { url } from '../utils/paths.js';
import {
  acceptInvitation,
  forgetInvitation,
  getInvitationPreview,
  recallInvitation,
  rememberInvitation,
} from '../invitations/invitations.js';
import { authPage } from './auth-shared.js';

const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('token');
if (fromLink) {
  rememberInvitation(fromLink);
  // Take the token out of the address bar and history.
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
const token = fromLink || recallInvitation();

const card = (body) => authPage(body, { skipRedirect: true });

function deadEnd(title, body) {
  forgetInvitation();
  return card(html`<h1>${title}</h1><p class="muted" style="margin-top:8px">${body}</p>
    <a class="btn btn-quiet btn-block" style="margin-top:var(--s-5)" href="${url('index.html')}">Go to TeamFlow</a>`);
}

async function main() {
  if (!token) {
    return deadEnd('This invitation link is incomplete', 'Open the full link you were sent. If it still does not work, ask for a new invitation.');
  }

  let invitation;
  try {
    invitation = await getInvitationPreview(token);
  } catch (error) {
    await card(html`<h1>We could not check this invitation</h1><p class="muted" style="margin-top:8px">${error.message}</p>
      <button class="btn btn-block" type="button" id="retry" style="margin-top:var(--s-5)">Try again</button>`);
    $('#retry')?.addEventListener('click', () => window.location.reload());
    return;
  }

  if (!invitation) return deadEnd('This invitation link is not valid', 'Check that you opened the whole link. If you did, ask the person who invited you for a new one.');
  if (invitation.status === 'accepted') {
    forgetInvitation();
    return card(html`<h1>You are already in</h1>
      <p class="muted" style="margin-top:8px">This invitation to <strong>${invitation.project_name}</strong> has been used. Sign in to open the project.</p>
      <a class="btn btn-block" style="margin-top:var(--s-5)" href="${url('login.html')}">Sign in</a>`);
  }
  if (invitation.status === 'revoked') return deadEnd('This invitation was withdrawn', `${invitation.invited_by_name} withdrew it. Ask them for a new one if you still need access.`);
  if (invitation.status === 'expired') return deadEnd('This invitation has expired', `Invitations last 7 days. Ask ${invitation.invited_by_name} to send you a new link.`);

  const intro = html`<div class="empty-icon"><i data-lucide="mail"></i></div>
    <h1>Join ${invitation.project_name}</h1>
    <p class="muted" style="margin-top:8px">${invitation.invited_by_name} invited <strong>${invitation.email}</strong>.
      This link works until ${formatDate(invitation.expires_at)}.</p>`;

  const session = await getSession().catch(() => null);
  if (!session) {
    return card(html`${intro}
      <p class="small" style="margin-top:var(--s-4)">Sign in or create an account with that email address to accept.</p>
      <div class="stack-sm" style="margin-top:var(--s-5)">
        <a class="btn btn-block" href="${url('register.html', { email: invitation.email })}">Create an account</a>
        <a class="btn btn-quiet btn-block" href="${url('login.html')}">I already have an account</a>
      </div>`);
  }

  const profile = await getCurrentProfile().catch(() => null);
  const signedInAs = (profile?.email || session.user.email || '').toLowerCase();

  if (signedInAs !== invitation.email) {
    await card(html`${intro}
      <p class="form-message is-error" style="margin-top:var(--s-4)">You are signed in as ${signedInAs}, but this invitation is for ${invitation.email}.</p>
      <button class="btn btn-block" type="button" id="switch-account" style="margin-top:var(--s-5)">Sign out and use the right account</button>`);
    $('#switch-account').addEventListener('click', async () => {
      await signOut();
      window.location.replace(url('login.html'));
    });
    return;
  }

  await card(html`${intro}
    <p class="form-message" id="form-message" hidden style="margin-top:var(--s-4)"></p>
    <button class="btn btn-block" type="button" id="accept" style="margin-top:var(--s-5)">Join ${invitation.project_name}</button>`);

  $('#accept').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true);
    try {
      const projectId = await acceptInvitation(token);
      forgetInvitation();
      forgetAccess();
      window.location.replace(url('app/project.html', { id: projectId, joined: 1 }));
    } catch (error) {
      const message = $('#form-message');
      message.hidden = false;
      message.className = 'form-message is-error';
      message.textContent = error.message;
      setBusy(button, false);
    }
  });
}

await main();
