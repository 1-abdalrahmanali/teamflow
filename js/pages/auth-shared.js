// Shared by the sign-in, sign-up and password pages.
import { isConfigured } from '../config/supabase.js';
import { defaultDestination, redirectIfSignedIn } from '../auth/guards.js';
import { $, html, render } from '../utils/dom.js';
import { url } from '../utils/paths.js';
import { brand, notConfigured } from '../components/layout.js';
import { recallInvitation } from '../invitations/invitations.js';

// Someone mid-invitation goes back to finish it; everyone else goes where they were headed.
export function destinationFor(access) {
  return recallInvitation() ? url('accept-invitation.html') : defaultDestination(access);
}

// Renders a centred card. Returns false (and renders the setup notice) when the app is not configured.
export async function authPage(content, { skipRedirect = false } = {}) {
  const root = $('#app');
  if (!isConfigured) {
    render(root, notConfigured());
    return false;
  }
  if (!skipRedirect) await redirectIfSignedIn(destinationFor);
  render(root, html`<div class="auth-shell"><div class="auth-card">${brand()}<div class="card card-pad" id="auth-body">${content}</div></div></div>`);
  return true;
}

export function invitationBanner() {
  if (!recallInvitation()) return '';
  return html`<div class="invite-banner"><i data-lucide="mail"></i>
    <span class="small">You are joining a project by invitation. Use the email address the invitation was sent to.</span></div>`;
}

export function passwordToggle(input, button) {
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(show));
  });
}
