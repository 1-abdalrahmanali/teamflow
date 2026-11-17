// A task's discussion: questions and comments with one level of replies. Everyone
// on the task can post; people edit their own posts; managers pin and remove any post.
import { deletePost, editPost, listThreads, postReply, postThread, setPinned } from '../discussions/discussions.js';
import { $, html, icon, on, render, setBusy } from '../utils/dom.js';
import { formatDateTime, timeAgo } from '../utils/format.js';
import { confirmDialog } from './modal.js';
import { toast, toastError } from './toast.js';
import { avatar, emptyState } from './ui.js';

const edited = (post) => new Date(post.updated_at) - new Date(post.created_at) > 5000;

// roles: Map of user id -> 'team_leader' | 'member' for this project; admins: Set of Platform Admin ids.
function authorLine(post, { roles, admins }) {
  const name = post.author?.full_name || 'Former member';
  const role = admins.has(post.user_id) ? 'Platform Admin' : roles.get(post.user_id) === 'team_leader' ? 'Team Leader' : '';
  return html`<span class="post-author">${avatar(post.author || { full_name: name })}
    <span class="strong">${name}</span>${role ? html`<span class="role-tag role-mini">${role}</span>` : ''}
    <span class="faint small" title="${formatDateTime(post.created_at)}">${timeAgo(post.created_at)}${edited(post) ? ', edited' : ''}</span>
  </span>`;
}

function postActions(post, { me, canManage, canWrite, isReply }) {
  if (!canWrite) return '';
  const mine = post.user_id === me;
  return html`<div class="post-actions">
    ${!isReply ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="reply">${icon('reply')}Reply</button>` : ''}
    ${mine ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="edit">${icon('pencil')}Edit</button>` : ''}
    ${!isReply && canManage
      ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="${post.is_pinned ? 'unpin' : 'pin'}">${icon(post.is_pinned ? 'pin-off' : 'pin')}${post.is_pinned ? 'Unpin' : 'Pin'}</button>`
      : ''}
    ${mine || canManage ? html`<button class="btn btn-ghost btn-sm" type="button" data-act="delete">${icon('trash-2')}Delete</button>` : ''}
  </div>`;
}

function postBody(post, ctx, isReply) {
  return html`<div class="post ${isReply ? 'post-reply' : ''}" data-post="${post.id}">
    <div class="post-head">${authorLine(post, ctx)}</div>
    <p class="post-text prewrap" data-text>${post.content}</p>
    ${postActions(post, { ...ctx, isReply })}
  </div>`;
}

function thread(post, ctx) {
  const answered = post.kind === 'question' && post.replies.some((reply) => reply.user_id !== post.user_id);
  return html`<li class="thread ${post.is_pinned ? 'is-pinned' : ''} ${post.kind === 'question' ? 'is-question' : ''}" data-thread="${post.id}">
    <div class="thread-tags">
      ${post.is_pinned ? html`<span class="tag tag-pin">${icon('pin')}Pinned</span>` : ''}
      ${post.kind === 'question'
        ? html`<span class="tag ${answered ? 'tag-answered' : 'tag-question'}">${icon(answered ? 'circle-check' : 'message-circle-question')}${answered ? 'Answered' : 'Question'}</span>`
        : ''}
    </div>
    ${postBody(post, ctx, false)}
    ${post.replies.length ? html`<ul class="replies">${post.replies.map((reply) => html`<li>${postBody(reply, ctx, true)}</li>`)}</ul>` : ''}
    <div class="reply-box" data-reply-box hidden></div>
  </li>`;
}

const composer = (placeholder) => html`<form class="composer" data-composer novalidate>
  <div class="segmented" role="radiogroup" aria-label="Type of post">
    <label><input type="radio" name="kind" value="question" checked><span>${icon('message-circle-question')}Ask a question</span></label>
    <label><input type="radio" name="kind" value="comment"><span>${icon('message-square')}Comment</span></label>
  </div>
  <textarea class="textarea" name="content" rows="3" maxlength="4000" placeholder="${placeholder}" aria-label="Your post"></textarea>
  <div class="row row-between">
    <span class="small faint">Everyone on this task can read it.</span>
    <button class="btn btn-sm" type="submit">${icon('send')}Post</button>
  </div>
</form>`;

const inlineForm = (value, label) => html`<form class="inline-form" novalidate>
  <textarea class="textarea" name="content" rows="2" maxlength="4000" aria-label="${label}">${value}</textarea>
  <div class="row" style="justify-content:flex-end">
    <button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancel</button>
    <button class="btn btn-sm" type="submit">${label}</button>
  </div>
</form>`;

// canWrite: the project is active. canManage: this person manages the project.
export async function mountDiscussion(container, { task, me, canManage, canWrite, roles = new Map(), admins = new Set() }) {
  let threads = [];
  const ctx = { me, canManage, canWrite, roles, admins };

  async function refresh() {
    threads = await listThreads(task.id);
    draw();
  }

  function draw() {
    const pinned = threads.filter((t) => t.is_pinned);
    const rest = threads.filter((t) => !t.is_pinned);
    render(
      container,
      html`<div class="panel-head">
          <h2 class="section-title">${icon('messages-square')}Discussion</h2>
          <span class="small faint">${threads.length ? `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'}` : ''}</span>
        </div>
        ${canWrite ? composer(canManage ? 'Answer a question, share a tip, or clarify the requirements.' : 'Stuck or unsure? Ask here and the Team Leader will answer.') : ''}
        ${!canWrite ? html`<p class="small faint">This project is archived, so the discussion is read-only.</p>` : ''}
        ${threads.length
          ? html`${pinned.length ? html`<ul class="threads threads-pinned">${pinned.map((t) => thread(t, ctx))}</ul>` : ''}
              <ul class="threads">${rest.map((t) => thread(t, ctx))}</ul>`
          : emptyState({ iconName: 'messages-square', title: 'No questions yet', body: 'Questions and answers about this task will show here.' })}`,
    );
    const form = $('[data-composer]', container);
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('[type="submit"]', form);
      setBusy(button, true);
      try {
        await postThread(task.id, form.kind.value, form.content.value);
        toast(form.kind.value === 'question' ? 'Question posted' : 'Comment posted');
        await refresh();
      } catch (error) {
        toastError(error);
        setBusy(button, false);
      }
    });
  }

  const findPost = (id) => {
    for (const t of threads) {
      if (t.id === id) return t;
      const reply = t.replies.find((r) => r.id === id);
      if (reply) return reply;
    }
    return null;
  };

  on(container, 'click', '[data-act]', async (event, button) => {
    const postEl = button.closest('[data-post]');
    const post = findPost(postEl?.dataset.post);
    if (!post) return;
    const act = button.dataset.act;
    try {
      if (act === 'reply') {
        const box = $('[data-reply-box]', button.closest('[data-thread]'));
        box.hidden = false;
        render(box, inlineForm('', 'Reply'));
        const form = $('form', box);
        form.content.focus();
        $('[data-cancel]', form).addEventListener('click', () => {
          box.hidden = true;
          box.replaceChildren();
        });
        form.addEventListener('submit', async (submitEvent) => {
          submitEvent.preventDefault();
          const send = $('[type="submit"]', form);
          setBusy(send, true);
          try {
            await postReply(task.id, post.id, form.content.value);
            toast('Reply posted');
            await refresh();
          } catch (error) {
            toastError(error);
            setBusy(send, false);
          }
        });
      } else if (act === 'edit') {
        const text = $('[data-text]', postEl);
        const actions = $('.post-actions', postEl);
        text.hidden = true;
        actions.hidden = true;
        const holder = document.createElement('div');
        text.after(holder);
        render(holder, inlineForm(post.content, 'Save'));
        const form = $('form', holder);
        form.content.focus();
        $('[data-cancel]', form).addEventListener('click', () => {
          holder.remove();
          text.hidden = false;
          actions.hidden = false;
        });
        form.addEventListener('submit', async (submitEvent) => {
          submitEvent.preventDefault();
          const save = $('[type="submit"]', form);
          setBusy(save, true);
          try {
            await editPost(post.id, form.content.value);
            toast('Post saved');
            await refresh();
          } catch (error) {
            toastError(error);
            setBusy(save, false);
          }
        });
      } else if (act === 'delete') {
        const hasReplies = Boolean(post.replies?.length);
        const yes = await confirmDialog({
          title: 'Delete this post?',
          body: hasReplies ? 'The post and its replies will be deleted for everyone.' : 'It will be deleted for everyone.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!yes) return;
        await deletePost(post.id);
        toast('Post deleted');
        await refresh();
      } else if (act === 'pin' || act === 'unpin') {
        await setPinned(post.id, act === 'pin');
        toast(act === 'pin' ? 'Pinned to the top' : 'Unpinned');
        await refresh();
      }
    } catch (error) {
      toastError(error);
    }
  });

  await refresh();
  return { refresh };
}
