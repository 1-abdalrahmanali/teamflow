// register.html. Every new account is a member; administrators are promoted by hand.
import { signUp } from '../auth/auth.js';
import { loadAccess } from '../auth/access.js';
import { $, formValues, html, render, setBusy } from '../utils/dom.js';
import { param, url } from '../utils/paths.js';
import { MIN_PASSWORD_LENGTH } from '../utils/constants.js';
import { isEmail, passwordProblem, showFormMessage } from '../utils/validate.js';
import { recallInvitation } from '../invitations/invitations.js';
import { authPage, destinationFor, invitationBanner, passwordToggle } from './auth-shared.js';

const prefilledEmail = param('email') || '';

const ready = await authPage(html`
  ${invitationBanner()}
  <h1>Create your account</h1>
  <p class="muted">You will see the projects you are invited to as soon as you sign in.</p>
  <form id="register-form" novalidate>
    <label class="field">
      <span class="field-label">Your name</span>
      <input class="input" name="fullName" autocomplete="name" maxlength="120" required autofocus placeholder="As your team knows you">
    </label>
    <label class="field">
      <span class="field-label">Email</span>
      <input class="input" type="email" name="email" autocomplete="email" required value="${prefilledEmail}">
    </label>
    <div class="field">
      <label class="field-label" for="password">Password</label>
      <div class="row" style="gap:var(--s-2)">
        <input class="input" id="password" type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
        <button class="btn btn-quiet" type="button" id="toggle-password" aria-pressed="false">Show</button>
      </div>
      <p class="field-hint">At least ${MIN_PASSWORD_LENGTH} characters.</p>
    </div>
    <p class="form-message" id="form-message" hidden style="margin-top:var(--s-4)"></p>
    <button class="btn btn-block" type="submit" style="margin-top:var(--s-5)">Create account</button>
  </form>
  <p class="auth-alt">Already have an account? <a href="${url('login.html', { next: param('next') })}">Sign in</a></p>
`);

if (ready) {
  const form = $('#register-form');
  const message = $('#form-message');
  passwordToggle(form.password, $('#toggle-password'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { fullName, email, password } = formValues(form);
    if (!fullName) return showFormMessage(message, 'Tell us your name, so your team knows who you are.');
    if (!isEmail(email)) return showFormMessage(message, 'Enter a valid email address.');
    const problem = passwordProblem(password);
    if (problem) return showFormMessage(message, problem);

    const button = $('[type="submit"]', form);
    setBusy(button, true);
    showFormMessage(message, '');
    try {
      const next = recallInvitation() ? url('accept-invitation.html') : param('next');
      const { needsConfirmation } = await signUp({ fullName, email, password, next });
      if (!needsConfirmation) {
        window.location.replace(destinationFor(await loadAccess({ fresh: true })));
        return;
      }
      render(
        $('#auth-body'),
        html`<div class="empty" style="padding:var(--s-4) 0">
          <div class="empty-icon"><i data-lucide="mail"></i></div>
          <h2>Check your inbox</h2>
          <p style="margin-top:8px">We sent a confirmation link to <strong>${email}</strong>. Open it on this device to finish
            ${recallInvitation() ? 'and join the project you were invited to' : 'setting up your account'}.</p>
          <p class="small faint" style="margin-top:var(--s-4)">Nothing there after a few minutes? Check your spam folder.</p>
        </div>`,
      );
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(button, false);
    }
  });
}
