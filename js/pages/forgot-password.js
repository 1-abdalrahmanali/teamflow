// forgot-password.html
import { sendPasswordReset } from '../auth/auth.js';
import { $, formValues, html, render, setBusy } from '../utils/dom.js';
import { url } from '../utils/paths.js';
import { isEmail, showFormMessage } from '../utils/validate.js';
import { authPage } from './auth-shared.js';

const ready = await authPage(html`
  <h1>Reset your password</h1>
  <p class="muted">Enter your email and we will send you a link to choose a new password.</p>
  <form id="reset-form" novalidate>
    <label class="field">
      <span class="field-label">Email</span>
      <input class="input" type="email" name="email" autocomplete="email" required autofocus>
    </label>
    <p class="form-message" id="form-message" hidden style="margin-top:var(--s-4)"></p>
    <button class="btn btn-block" type="submit" style="margin-top:var(--s-5)">Send reset link</button>
  </form>
  <p class="auth-alt"><a href="${url('login.html')}">Back to sign in</a></p>
`);

if (ready) {
  const form = $('#reset-form');
  const message = $('#form-message');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { email } = formValues(form);
    if (!isEmail(email)) return showFormMessage(message, 'Enter a valid email address.');
    const button = $('[type="submit"]', form);
    setBusy(button, true);
    try {
      await sendPasswordReset(email);
      // The same answer whether or not the account exists, so this page cannot be used to check emails.
      render(
        $('#auth-body'),
        html`<div class="empty" style="padding:var(--s-4) 0">
          <div class="empty-icon"><i data-lucide="mail"></i></div>
          <h2>Check your inbox</h2>
          <p style="margin-top:8px">If there is an account for <strong>${email}</strong>, a reset link is on its way.
            It works once and expires after an hour.</p>
          <a class="btn btn-quiet" href="${url('login.html')}">Back to sign in</a>
        </div>`,
      );
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(button, false);
    }
  });
}
