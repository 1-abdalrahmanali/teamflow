// settings.html, shared by administrators and members.
import { updatePassword, updateProfile, uploadAvatar } from '../auth/auth.js';
import { $, formValues, html, render, setBusy } from '../utils/dom.js';
import { MIN_PASSWORD_LENGTH } from '../utils/constants.js';
import { passwordProblem, showFormMessage } from '../utils/validate.js';
import { mountApp } from '../components/layout.js';
import { avatar } from '../components/ui.js';
import { toast, toastError } from '../components/toast.js';

const { profile, page } = await mountApp({ area: 'shared', active: 'settings', title: 'Settings', subtitle: 'Your profile and password.' });
let current = profile;

function draw() {
  render(
    page,
    html`<div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Profile</h3></div>
        <form class="card-body" id="profile-form" novalidate>
          <div class="row" style="gap:var(--s-4);margin-bottom:var(--s-5)">
            <span id="avatar-slot">${avatar(current, 'xl')}</span>
            <div class="stack-sm">
              <label class="btn btn-quiet btn-sm" style="cursor:pointer">
                <i data-lucide="camera"></i>Change photo
                <input type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp" class="sr-only">
              </label>
              <p class="tiny faint">PNG, JPG or WebP, up to 2 MB.</p>
            </div>
          </div>
          <label class="field">
            <span class="field-label">Name</span>
            <input class="input" name="fullName" maxlength="120" required value="${current.full_name}">
          </label>
          <label class="field">
            <span class="field-label">Email</span>
            <input class="input" value="${current.email}" disabled>
            <span class="field-hint">Your email is how invitations find you, so it cannot be changed here.</span>
          </label>
          <div class="field">
            <span class="field-label">Role</span>
            <p class="muted">${current.platform_role === 'administrator' ? 'Administrator: you can create projects and review work.' : 'Member: you work on tasks in the projects you join.'}</p>
          </div>
          <p class="form-message" id="profile-message" hidden style="margin-top:var(--s-4)"></p>
          <button class="btn" type="submit" style="margin-top:var(--s-5)">Save changes</button>
        </form>
      </section>

      <section class="card">
        <div class="card-head"><h3>Password</h3></div>
        <form class="card-body" id="password-form" novalidate>
          <label class="field">
            <span class="field-label">New password</span>
            <input class="input" type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}">
            <span class="field-hint">At least ${MIN_PASSWORD_LENGTH} characters.</span>
          </label>
          <label class="field">
            <span class="field-label">Type it again</span>
            <input class="input" type="password" name="confirm" autocomplete="new-password">
          </label>
          <p class="form-message" id="password-message" hidden style="margin-top:var(--s-4)"></p>
          <button class="btn" type="submit" style="margin-top:var(--s-5)">Save password</button>
        </form>
      </section>
    </div>`,
  );

  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('#profile-message');
    const { fullName } = formValues(form);
    if (!fullName) return showFormMessage(message, 'Your name cannot be empty.');
    const button = $('[type="submit"]', form);
    setBusy(button, true);
    try {
      current = await updateProfile({ full_name: fullName });
      showFormMessage(message, '');
      toast('Changes saved');
      document.querySelectorAll('.user-chip .person-name').forEach((el) => { el.textContent = current.full_name; });
    } catch (error) {
      showFormMessage(message, error.message);
    } finally {
      setBusy(button, false);
    }
  });

  $('#avatar-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      current = await uploadAvatar(file);
      render($('#avatar-slot'), avatar(current, 'xl'));
      toast('Photo updated');
    } catch (error) {
      toastError(error);
    } finally {
      event.target.value = '';
    }
  });

  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('#password-message');
    const { password, confirm } = formValues(form);
    const problem = passwordProblem(password);
    if (problem) return showFormMessage(message, problem);
    if (password !== confirm) return showFormMessage(message, 'The two passwords do not match.');
    const button = $('[type="submit"]', form);
    setBusy(button, true);
    try {
      await updatePassword(password);
      form.reset();
      showFormMessage(message, '');
      toast('Password saved');
    } catch (error) {
      showFormMessage(message, error.message);
    } finally {
      setBusy(button, false);
    }
  });
}

draw();
