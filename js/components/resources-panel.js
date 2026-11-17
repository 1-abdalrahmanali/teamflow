// Learning material on a task: videos, docs, articles, example projects and files.
// Managers add, edit and remove; the assignee opens them.
import {
  addResource,
  checkFile,
  checkLink,
  deleteResource,
  listResources,
  resourceFileUrl,
  updateResource,
  youtubeId,
} from '../resources/resources.js';
import { RESOURCE_TYPES } from '../utils/constants.js';
import { $, formValues, html, icon, on, render, safeLink, setBusy } from '../utils/dom.js';
import { showFormMessage } from '../utils/validate.js';
import { confirmDialog, openModal } from './modal.js';
import { toast, toastError } from './toast.js';
import { emptyState } from './ui.js';

const hostOf = (link) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function resourceItem(resource, { canEdit }) {
  const spec = RESOURCE_TYPES[resource.resource_type] || RESOURCE_TYPES.document;
  const isLink = spec.kind === 'link';
  const video = resource.resource_type === 'youtube' ? youtubeId(resource.external_url) : null;
  const where = isLink ? hostOf(resource.external_url) : resource.file_name;

  let actions;
  if (video) {
    actions = html`<button class="btn btn-sm" type="button" data-act="watch">${icon('circle-play')}Watch here</button>
      <a class="btn btn-quiet btn-sm" href="${safeLink(resource.external_url)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}YouTube</a>`;
  } else if (isLink) {
    actions = html`<a class="btn btn-quiet btn-sm" href="${safeLink(resource.external_url)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}Open</a>`;
  } else if (resource.resource_type === 'pdf' || resource.resource_type === 'image') {
    actions = html`<button class="btn btn-quiet btn-sm" type="button" data-act="preview">${icon('eye')}View</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="download">${icon('download')}Download</button>`;
  } else {
    actions = html`<button class="btn btn-quiet btn-sm" type="button" data-act="download">${icon('download')}Download</button>`;
  }

  return html`<li class="resource" data-id="${resource.id}">
    <span class="resource-icon ri-${resource.resource_type}">${icon(spec.icon)}</span>
    <div class="grow resource-main">
      <p class="strong resource-title">${resource.title}</p>
      <p class="small faint">${spec.label}${where ? html`, <span class="resource-where">${where}</span>` : ''}</p>
      ${resource.description ? html`<p class="small prewrap" style="margin-top:var(--s-1)">${resource.description}</p>` : ''}
      <div class="resource-player" data-player hidden></div>
    </div>
    <div class="row row-wrap resource-actions">
      ${actions}
      ${canEdit
        ? html`<button class="btn btn-ghost btn-sm btn-icon" type="button" data-act="edit" aria-label="Edit ${resource.title}" title="Edit">${icon('pencil')}</button>
            <button class="btn btn-ghost btn-sm btn-icon" type="button" data-act="delete" aria-label="Remove ${resource.title}" title="Remove">${icon('trash-2')}</button>`
        : ''}
    </div>
  </li>`;
}

function typeOptions(selected) {
  const group = (kind, label) => html`<optgroup label="${label}">
    ${Object.entries(RESOURCE_TYPES)
      .filter(([, spec]) => spec.kind === kind)
      .map(([key, spec]) => html`<option value="${key}" ${key === selected ? html`selected` : ''}>${spec.label}</option>`)}
  </optgroup>`;
  return html`${group('link', 'A link')}${group('file', 'A file')}`;
}

function openResourceDialog({ task, resource = null, onSaved }) {
  const editing = Boolean(resource);
  const startType = resource?.resource_type || 'youtube';
  openModal({
    title: editing ? 'Edit resource' : 'Add learning material',
    body: html`<form novalidate>
      ${editing
        ? html`<p class="muted small" style="margin-bottom:var(--s-4)">${RESOURCE_TYPES[startType].label}${
            resource.file_name ? html`: ${resource.file_name}` : ''
          }</p>`
        : html`<label class="field">
            <span class="field-label">What are you adding?</span>
            <select class="select" name="type">${typeOptions(startType)}</select>
          </label>`}
      <label class="field">
        <span class="field-label">Title</span>
        <input class="input" name="title" maxlength="200" required value="${resource?.title || ''}" placeholder="Intro to CSS grid">
      </label>
      <label class="field" data-for="link">
        <span class="field-label">Link</span>
        <input class="input" name="link" type="url" inputmode="url" value="${resource?.external_url || ''}" placeholder="https://">
        <span class="field-hint" data-hint></span>
      </label>
      <label class="field" data-for="file">
        <span class="field-label">File</span>
        <input class="input" name="file" type="file">
        <span class="field-hint" data-hint></span>
      </label>
      <label class="field">
        <span class="field-label">Why it helps <span class="faint">(optional)</span></span>
        <textarea class="textarea" name="description" maxlength="2000" rows="3"
          placeholder="Watch the first ten minutes before you start.">${resource?.description || ''}</textarea>
      </label>
      <p class="form-message" data-message hidden style="margin-top:var(--s-4)"></p>
      <div class="row" style="justify-content:flex-end;margin-top:var(--s-5)">
        <button class="btn btn-quiet" type="button" data-close>Cancel</button>
        <button class="btn" type="submit">${editing ? 'Save changes' : 'Add to task'}</button>
      </div>
    </form>`,
    onMount(modal, close) {
      const form = $('form', modal);
      const message = $('[data-message]', modal);
      const linkField = $('[data-for="link"]', form);
      const fileField = $('[data-for="file"]', form);
      const currentType = () => (editing ? startType : form.type.value);
      const sync = () => {
        const spec = RESOURCE_TYPES[currentType()];
        const isLink = spec.kind === 'link';
        linkField.hidden = !isLink;
        fileField.hidden = isLink || editing;
        $('[data-hint]', linkField).textContent = spec.hint || '';
        if (!isLink) {
          form.file.accept = spec.exts.map((ext) => `.${ext}`).join(',');
          $('[data-hint]', fileField).textContent = `${spec.exts.join(', ')}. Up to 20 MB.`;
        }
      };
      sync();
      form.type?.addEventListener('change', sync);
      $('[data-close]', form).addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = formValues(form);
        const type = currentType();
        const spec = RESOURCE_TYPES[type];
        if (!values.title) return showFormMessage(message, 'Give the resource a title.');
        const problem = spec.kind === 'link' ? checkLink(type, values.link) : editing ? null : checkFile(type, form.file.files[0]);
        if (problem) return showFormMessage(message, problem);
        const button = $('[type="submit"]', form);
        setBusy(button, true);
        try {
          if (editing) await updateResource(resource, { title: values.title, description: values.description, link: values.link });
          else await addResource({ task, type, title: values.title, description: values.description, link: values.link, file: form.file.files[0] });
          close();
          toast(editing ? 'Resource saved' : 'Resource added');
          onSaved?.();
        } catch (error) {
          showFormMessage(message, error.message);
          setBusy(button, false);
        }
      });
    },
  });
}

function preview(resource, link) {
  openModal({
    title: resource.title,
    wide: true,
    body: resource.resource_type === 'image'
      ? html`<img class="resource-image" src="${link}" alt="${resource.title}">`
      : html`<iframe class="resource-pdf" src="${link}" title="${resource.title}"></iframe>
          <p class="small faint" style="margin-top:var(--s-2)">If the file does not show, use Download instead.</p>`,
  });
}

// canEdit: this person manages the project and it is not archived.
export async function mountResources(container, { task, canEdit }) {
  let resources = [];

  async function refresh() {
    resources = await listResources(task.id);
    draw();
  }

  function draw() {
    render(
      container,
      html`<div class="panel-head">
          <h2 class="section-title">${icon('book-open')}Learning material</h2>
          ${canEdit ? html`<button class="btn btn-quiet btn-sm" type="button" data-act="add">${icon('plus')}Add</button>` : ''}
        </div>
        ${resources.length
          ? html`<ul class="resources">${resources.map((r) => resourceItem(r, { canEdit }))}</ul>`
          : emptyState({
              iconName: 'book-open',
              title: canEdit ? 'Nothing attached yet' : 'No learning material on this task',
              body: canEdit
                ? 'Add a video, the docs, an example project or starter files so the work can start without questions.'
                : 'Ask in the discussion below if something is unclear.',
            })}`,
    );
  }

  on(container, 'click', '[data-act]', async (event, button) => {
    const act = button.dataset.act;
    if (act === 'add') return openResourceDialog({ task, onSaved: refresh });
    const item = button.closest('[data-id]');
    const resource = resources.find((r) => r.id === item?.dataset.id);
    if (!resource) return;
    if (act === 'watch') {
      const player = $('[data-player]', item);
      if (player.hidden) {
        render(
          player,
          html`<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${youtubeId(resource.external_url)}"
            title="${resource.title}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div>`,
        );
        player.hidden = false;
        button.lastChild.textContent = 'Hide video';
      } else {
        player.replaceChildren();
        player.hidden = true;
        button.lastChild.textContent = 'Watch here';
      }
      return;
    }
    if (act === 'edit') return openResourceDialog({ task, resource, onSaved: refresh });
    if (act === 'delete') {
      const yes = await confirmDialog({
        title: 'Remove this resource?',
        body: `"${resource.title}" will be removed from the task${resource.storage_path ? ' and its file deleted' : ''}.`,
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!yes) return;
      try {
        await deleteResource(resource);
        toast('Resource removed');
        await refresh();
      } catch (error) {
        toastError(error);
      }
      return;
    }
    if (act === 'preview' || act === 'download') {
      setBusy(button, true);
      try {
        const link = await resourceFileUrl(resource, { download: act === 'download' });
        if (act === 'download') window.location.assign(link);
        else preview(resource, link);
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(button, false);
      }
    }
  });

  await refresh();
  return { refresh };
}
