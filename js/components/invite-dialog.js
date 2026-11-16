// Inviting someone: the database makes a one-time link, and the administrator
// sends it personally (email, chat, whatever they use).
import { createInvitation } from '../invitations/invitations.js';
import { $, formValues, html, render, setBusy } from '../utils/dom.js';
import { formatDate } from '../utils/format.js';
import { isEmail, showFormMessage } from '../utils/validate.js';
import { copyText } from './code-editor.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

// projects: the active projects the administrator owns. projectId preselects one.
export function openInviteDialog({ projects, projectId, onCreated } = {}) {
  const fixed = projects.length === 1 || Boolean(projectId);
  const chosen = projects.find((p) => p.id === projectId) || projects[0];

  openModal({
    title: 'Invite someone',
    body: html`<form novalidate>
      ${fixed
        ? html`<p class="muted" style="margin-bottom:var(--s-4)">They will join <strong>${chosen.name}</strong>.</p>
            <input type="hidden" name="project" value="${chosen.id}">`
        : html`<label class="field">
            <span class="field-label">Project</span>
            <select class="select" name="project">
              ${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}
            </select>
          </label>`}
      <label class="field">
        <span class="field-label">Their email address</span>
        <input class="input" type="email" name="email" autocomplete="off" required autofocus placeholder="name@example.com">
        <span class="field-hint">They must sign up or sign in with this exact address to join.</span>
      </label>
      <p class="form-message" data-message hidden style="margin-top:var(--s-4)"></p>
      <div class="row" style="justify-content:flex-end;margin-top:var(--s-5)">
        <button class="btn btn-quiet" type="button" data-close>Cancel</button>
        <button class="btn" type="submit">Create invitation link</button>
      </div>
    </form>`,
    onMount(modal, close) {
      const form = $('form', modal);
      const message = $('[data-message]', modal);
      $('[data-close]', form).addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = formValues(form);
        if (!isEmail(values.email)) {
          showFormMessage(message, 'Enter a valid email address.');
          form.email.focus();
          return;
        }
        const button = $('[type="submit"]', form);
        setBusy(button, true);
        try {
          const invitation = await createInvitation(values.project, values.email);
          const project = projects.find((p) => p.id === values.project);
          showLink($('.modal-body', modal), { invitation, project, close });
          onCreated?.(invitation);
        } catch (error) {
          showFormMessage(message, error.message);
          setBusy(button, false);
        }
      });
    },
  });
}

function showLink(body, { invitation, project, close }) {
  const note = `Hi! I've added you to "${project?.name || 'our project'}" on TeamFlow. Open this link to join (it works once, until ${formatDate(invitation.expires_at)}):\n\n${invitation.link}\n\nUse ${invitation.email} when you sign up or sign in.`;
  render(
    body,
    html`<div class="stack">
      <div class="form-message is-good">Invitation ready for <strong>${invitation.email}</strong>.</div>
      <p class="muted small">Send this link yourself. It works once, only for that email, until
        ${formatDate(invitation.expires_at)}. For safety it is shown only now: if it gets lost, revoke the
        invitation and create a new one.</p>
      <div class="link-box">
        <input class="input" readonly value="${invitation.link}" aria-label="Invitation link" data-link>
        <button class="btn" type="button" data-copy="link"><i data-lucide="copy"></i>Copy link</button>
      </div>
      <div class="row row-wrap" style="justify-content:space-between">
        <button class="btn btn-quiet" type="button" data-copy="message"><i data-lucide="message-square"></i>Copy a ready-made message</button>
        <button class="btn btn-ghost" type="button" data-done>Done</button>
      </div>
    </div>`,
  );
  $('[data-link]', body).addEventListener('focus', (event) => event.target.select());
  $('[data-done]', body).addEventListener('click', close);
  body.addEventListener('click', async (event) => {
    const which = event.target.closest('[data-copy]')?.dataset.copy;
    if (!which) return;
    const copied = await copyText(which === 'link' ? invitation.link : note);
    toast(copied ? (which === 'link' ? 'Link copied' : 'Message copied') : 'Copy failed. Select the link and copy it by hand.', copied ? 'good' : 'error');
  });
}
