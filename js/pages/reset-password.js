// reset-password.html. The emailed link signs the person in for this one purpose.
import { getSession, signOut, updatePassword } from '../auth/auth.js';
import { $, formValues, html, setBusy } from '../utils/dom.js';
import { url } from '../utils/paths.js';
import { MIN_PASSWORD_LENGTH } from '../utils/constants.js';
import { passwordProblem, showFormMessage } from '../utils/validate.js';
import { authPage, passwordToggle } from './auth-shared.js';

const session = await getSession().catch(() => null);

const ready = await authPage(
  session
    ? html`<h1>Choose a new password</h1>
      <p class="muted">Signed in as ${session.user.email}.</p>
      <form id="new-password-form" novalidate>
        <div class="field">
          <label class="field-label" for="password">New password</label>
          <div class="row" style="gap:var(--s-2)">
            <input class="input" id="password" type="password" name="password" autocomplete="new-password" required autofocus>
            <button class="btn btn-quiet" type="button" id="toggle-password" aria-pressed="false">Show</button>
          </div>
          <p class="field-hint">At least ${MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <p class="form-message" id="form-message" hidden style="margin-top:var(--s-4)"></p>
        <button class="btn btn-block" type="submit" style="margin-top:var(--s-5)">Save new password</button>
      </form>`
    : html`<h1>This link has expired</h1>
      <p class="muted" style="margin-top:8px">Reset links work once and only for a short time. Ask for a new one and use it straight away.</p>
      <a class="btn btn-block" style="margin-top:var(--s-5)" href="${url('forgot-password.html')}">Send a new reset link</a>`,
  { skipRedirect: true },
);

if (ready && session) {
  const form = $('#new-password-form');
  const message = $('#form-message');
  passwordToggle(form.password, $('#toggle-password'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { password } = formValues(form);
    const problem = passwordProblem(password);
    if (problem) return showFormMessage(message, problem);
    const button = $('[type="submit"]', form);
    setBusy(button, true);
    try {
      await updatePassword(password);
      await signOut();
      window.location.replace(url('login.html', { reset: 1 }));
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(button, false);
    }
  });
}
