// Inviting someone. The invitation is emailed when email is set up; the link is
// always shown too, once, so it can be sent another way if the email goes astray.
import { resendInvitation, sendInvitation } from '../invitations/invitations.js';
import { $, formValues, html, render, setBusy } from '../utils/dom.js';
import { formatDate } from '../utils/format.js';
import { isEmail, showFormMessage } from '../utils/validate.js';
import { copyText } from './code-editor.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

// projects: the active projects this person manages. projectId preselects one.
export function openInviteDialog({ projects, projectId, onCreated } = {}) {
  const fixed = projects.length === 1 || Boolean(projectId);
  const chosen = projects.find((p) => p.id === projectId) || projects[0];

  openModal({
    title: 'Invite someone',
    body: html`<form novalidate>
      ${fixed
        ? html`<p class="muted" style="margin-bottom:var(--s-4)">They will join <strong>${chosen.name}</strong> as a member.</p>
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
        <span class="field-hint">We email them a link. They must sign up or sign in with this exact address to join.</span>
      </label>
      <p class="form-message" data-message hidden style="margin-top:var(--s-4)"></p>
      <div class="row" style="justify-content:flex-end;margin-top:var(--s-5)">
        <button class="btn btn-quiet" type="button" data-close>Cancel</button>
        <button class="btn" type="submit">${html`<i data-lucide="send"></i>`}Send invitation</button>
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
          const invitation = await sendInvitation({ projectId: values.project, email: values.email.toLowerCase() });
          const project = projects.find((p) => p.id === values.project);
          showResult($('.modal-body', modal), { invitation, project, close });
          onCreated?.(invitation);
        } catch (error) {
          showFormMessage(message, error.message);
          setBusy(button, false);
        }
      });
    },
  });
}

// Sends a fresh link for an existing invitation and shows the result.
export async function resendWithDialog(invitation, { onDone } = {}) {
  const result = await resendInvitation(invitation.id);
  openModal({
    title: 'Invitation sent again',
    body: html`<div></div>`,
    onMount(modal, close) {
      showResult($('.modal-body', modal), { invitation: result, project: invitation.project, close });
    },
  });
  onDone?.(result);
}

function showResult(body, { invitation, project, close }) {
  const note = `Hi! I've added you to "${project?.name || 'our project'}" on TeamFlow. Open this link to join (it works once, until ${formatDate(invitation.expiresAt)}):\n\n${invitation.link}\n\nUse ${invitation.email} when you sign up or sign in.`;
  render(
    body,
    html`<div class="stack">
      ${invitation.emailSent
        ? html`<div class="form-message is-good">Invitation emailed to <strong>${invitation.email}</strong>.</div>
            <p class="muted small">The link works once, only for that address, until ${formatDate(invitation.expiresAt)}.
              If the email does not arrive, copy the link below and send it yourself.</p>`
        : html`<div class="form-message is-info">Invitation ready for <strong>${invitation.email}</strong>, but it was not emailed.</div>
            <p class="muted small">${invitation.emailError || 'Copy the link and send it yourself.'} It works once, only for that
              address, until ${formatDate(invitation.expiresAt)}.</p>`}
      <p class="small faint">For safety the link is shown only now. If it gets lost, use Send again on the invitation.</p>
      <div class="link-box">
        <input class="input" readonly value="${invitation.link}" aria-label="Invitation link" data-link>
        <button class="btn ${invitation.emailSent ? 'btn-quiet' : ''}" type="button" data-copy="link"><i data-lucide="copy"></i>Copy link</button>
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
