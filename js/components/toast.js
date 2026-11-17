// Short confirmations in the corner. They say what happened, using the same
// verb as the button that caused it.
import { html, render } from '../utils/dom.js';

const FLASH_KEY = 'teamflow.flash';
let stack;

export function toast(message, tone = 'good') {
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  const item = document.createElement('div');
  item.className = `toast is-${tone}`;
  // Added to the page first, so its icon is drawn along with it.
  stack.append(item);
  render(item, html`<i data-lucide="${tone === 'error' ? 'circle-alert' : 'circle-check'}"></i><span>${message}</span>`);
  setTimeout(() => item.remove(), tone === 'error' ? 6500 : 3800);
}

export const toastError = (error) => toast(error?.message || String(error), 'error');

// A confirmation that survives the page change that follows it.
export function flashNext(message) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    // Without storage the confirmation is simply skipped.
  }
}

try {
  const pending = sessionStorage.getItem(FLASH_KEY);
  if (pending) {
    sessionStorage.removeItem(FLASH_KEY);
    setTimeout(() => toast(pending), 300);
  }
} catch {
  // Storage unavailable: nothing to show.
}
