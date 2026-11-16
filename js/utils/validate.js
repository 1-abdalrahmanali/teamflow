// Form checks for convenience. The database validates everything again.
import { MIN_PASSWORD_LENGTH } from './constants.js';

export function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim());
}

// Returns a message when the password is not acceptable, otherwise null.
export function passwordProblem(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function isGithubUrl(value) {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/\S*)?$/.test(String(value || '').trim());
}

// Shows or clears one message area for a form.
export function showFormMessage(element, message, tone = 'error') {
  if (!element) return;
  element.hidden = !message;
  element.className = `form-message is-${tone}`;
  element.textContent = message || '';
}
