// Safe rendering. Everything a person typed (names, task text, comments, code)
// reaches the page through html`...`, which escapes every interpolated value.
import { createIcons, icons } from 'https://cdn.jsdelivr.net/npm/lucide@1.73.0/+esm';

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function toHtml(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

// Tagged template: html`<p>${userText}</p>`. Nested html`` results and arrays
// of them pass through; every other value is escaped.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += toHtml(value) + strings[index + 1];
  });
  return new SafeHtml(out);
}

export function render(target, content) {
  target.innerHTML = toHtml(content);
  refreshIcons();
  return target;
}

// Turns <i data-lucide="name"> placeholders into Lucide SVG icons.
export function refreshIcons() {
  createIcons({ icons });
}

export const icon = (name) => html`<i data-lucide="${name}" aria-hidden="true"></i>`;

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Event delegation: one listener on a container handles clicks on rows rendered later.
export function on(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const match = event.target.closest(selector);
    if (match && root.contains(match)) handler(event, match);
  });
}

export function formValues(form) {
  const values = {};
  for (const [key, value] of new FormData(form)) {
    values[key] = typeof value === 'string' ? value.trim() : value;
  }
  return values;
}

export function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle('is-busy', busy);
  button.disabled = busy;
}

// Only http(s) links are ever placed in an href.
export function safeLink(value) {
  return /^https?:\/\//i.test(String(value ?? '')) ? String(value) : '#';
}
