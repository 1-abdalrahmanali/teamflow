// login.html
import { signIn } from '../auth/auth.js';
import { loadAccess } from '../auth/access.js';
import { $, formValues, html, setBusy } from '../utils/dom.js';
import { param, url } from '../utils/paths.js';
import { isEmail, showFormMessage } from '../utils/validate.js';
import { authPage, destinationFor, invitationBanner, passwordToggle } from './auth-shared.js';

const notices = {
  confirmed: ['Your email is confirmed. Sign in to continue.', 'good'],
  reset: ['Your password is updated. Sign in with the new one.', 'good'],
  expired: ['Your session ended. Sign in again to pick up where you left off.', 'info'],
};
const notice = Object.keys(notices).find((key) => param(key));

const ready = await authPage(html`
  ${invitationBanner()}
  <h1>Welcome back</h1>
  <p class="muted">Sign in to see your projects and tasks.</p>
  ${notice ? html`<p class="form-message is-${notices[notice][1]}" style="margin-top:var(--s-4)">${notices[notice][0]}</p>` : ''}
  <form id="login-form" novalidate>
    <label class="field">
      <span class="field-label">Email</span>
      <input class="input" type="email" name="email" autocomplete="email" required autofocus>
    </label>
    <div class="field">
      <div class="row row-between"><label class="field-label" for="password">Password</label>
        <a class="small" href="${url('forgot-password.html')}">Forgot it?</a></div>
      <div class="row" style="gap:var(--s-2)">
        <input class="input" id="password" type="password" name="password" autocomplete="current-password" required>
        <button class="btn btn-quiet" type="button" id="toggle-password" aria-pressed="false">Show</button>
      </div>
    </div>
    <p class="form-message" id="form-message" hidden style="margin-top:var(--s-4)"></p>
    <button class="btn btn-block" type="submit" style="margin-top:var(--s-5)">Sign in</button>
  </form>
  <p class="auth-alt">New here? <a href="${url('register.html', { next: param('next') })}">Create an account</a></p>
`);

if (ready) {
  const form = $('#login-form');
  const message = $('#form-message');
  passwordToggle(form.password, $('#toggle-password'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { email, password } = formValues(form);
    if (!isEmail(email)) return showFormMessage(message, 'Enter the email address you signed up with.');
    if (!password) return showFormMessage(message, 'Enter your password.');
    const button = $('[type="submit"]', form);
    setBusy(button, true);
    showFormMessage(message, '');
    try {
      await signIn(email, password);
      const access = await loadAccess({ fresh: true });
      window.location.replace(destinationFor(access));
    } catch (error) {
      showFormMessage(message, error.message);
      setBusy(button, false);
    }
  });
}
