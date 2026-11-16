// Dialogs. One at a time, closable with Escape or a click outside.
import { html, render } from '../utils/dom.js';

export function openModal({ title, body, wide = false, onMount }) {
  const previouslyFocused = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  render(
    scrim,
    html`<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head">
        <h2>${title}</h2>
        <button class="btn btn-ghost btn-icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`,
  );
  document.body.append(scrim);
  document.body.style.overflow = 'hidden';

  function close() {
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    document.body.style.overflow = '';
    previouslyFocused?.focus?.();
  }
  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  document.addEventListener('keydown', onKey);
  scrim.addEventListener('mousedown', (event) => {
    if (event.target === scrim) close();
  });
  scrim.querySelector('[data-close]').addEventListener('click', close);

  const modal = scrim.querySelector('.modal');
  onMount?.(modal, close);
  (modal.querySelector('[autofocus], input, textarea, select') || modal.querySelector('[data-close]')).focus();
  return { el: modal, close };
}

// Resolves true when the person confirms, false when they back out.
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      body: html`<p class="muted">${body}</p>
        <div class="row" style="justify-content:flex-end;margin-top:var(--s-5)">
          <button class="btn btn-quiet" type="button" data-answer="no">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : ''}" type="button" data-answer="yes" autofocus>${confirmLabel}</button>
        </div>`,
      onMount(modal, closeModal) {
        modal.addEventListener('click', (event) => {
          const answer = event.target.closest('[data-answer]')?.dataset.answer;
          if (!answer) return;
          answered = true;
          closeModal();
          resolve(answer === 'yes');
        });
        // Escape or a click outside counts as "no".
        const observer = new MutationObserver(() => {
          if (!document.body.contains(modal) && !answered) {
            observer.disconnect();
            resolve(false);
          }
        });
        observer.observe(document.body, { childList: true });
      },
    });
  });
}
