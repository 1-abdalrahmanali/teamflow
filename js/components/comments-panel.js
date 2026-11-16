// The discussion under a task. The project owner and the assignee can both write here.
import { addComment, listComments } from '../comments/comments.js';
import { $, html, render, setBusy } from '../utils/dom.js';
import { formatDateTime, timeAgo } from '../utils/format.js';
import { avatar, emptyState } from './ui.js';
import { toastError } from './toast.js';

function commentItem(comment, profile) {
  const mine = comment.user_id === profile.id;
  return html`<div class="comment ${mine ? 'is-mine' : ''}">
    ${avatar(comment.author, 'sm')}
    <div class="comment-bubble">
      <div class="comment-meta"><strong>${mine ? 'You' : comment.author?.full_name || 'Someone'}</strong>
        <time datetime="${comment.created_at}" title="${formatDateTime(comment.created_at)}">${timeAgo(comment.created_at)}</time></div>
      <p class="prewrap">${comment.content}</p>
    </div>
  </div>`;
}

export async function mountComments(container, { taskId, profile, canWrite = true }) {
  render(
    container,
    html`<section class="card">
      <div class="card-head"><h3>Discussion</h3></div>
      <div class="card-body">
        <div data-list><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div>
        ${canWrite
          ? html`<form data-form class="stack-sm" style="margin-top:var(--s-5)">
              <label class="sr-only" for="comment-${taskId}">Write a comment</label>
              <textarea class="textarea" id="comment-${taskId}" name="content" maxlength="4000" style="min-height:80px"
                placeholder="Ask a question or leave a note. Ctrl+Enter sends."></textarea>
              <div class="row" style="justify-content:flex-end"><button class="btn btn-sm" type="submit">Post comment</button></div>
            </form>`
          : ''}
      </div>
    </section>`,
  );

  const list = $('[data-list]', container);
  let comments = [];
  const draw = () =>
    render(
      list,
      comments.length
        ? comments.map((comment) => commentItem(comment, profile))
        : emptyState({ iconName: 'messages-square', title: 'No comments yet', body: 'Questions about this task go here, so everyone sees the same answer.' }),
    );

  try {
    comments = await listComments(taskId);
    draw();
  } catch (error) {
    render(list, html`<p class="form-message is-error">${error.message}</p>`);
  }

  const form = $('[data-form]', container);
  if (!form) return;
  const send = async () => {
    const content = form.content.value.trim();
    if (!content) return;
    const button = $('[type="submit"]', form);
    setBusy(button, true);
    try {
      comments.push(await addComment(taskId, content));
      form.content.value = '';
      draw();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(button, false);
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
  form.content.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  });
}
