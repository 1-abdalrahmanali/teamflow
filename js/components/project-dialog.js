// The create and edit project dialog. Deadlines in a project follow its time zone.
import { createProject, updateProject } from '../projects/projects.js';
import { formValues, html, setBusy } from '../utils/dom.js';
import { allTimeZones, browserTimeZone } from '../utils/time.js';
import { showFormMessage } from '../utils/validate.js';
import { openModal } from './modal.js';
import { flashNext, toast } from './toast.js';

export function openProjectDialog({ project = null, onSaved } = {}) {
  const editing = Boolean(project);
  const zone = project?.timezone || browserTimeZone();
  const zones = allTimeZones();
  if (!zones.includes(zone)) zones.unshift(zone);

  openModal({
    title: editing ? 'Edit project' : 'New project',
    body: html`<form novalidate>
      <label class="field">
        <span class="field-label">Project name</span>
        <input class="input" name="name" maxlength="120" required autofocus value="${project?.name || ''}"
          placeholder="Website relaunch">
      </label>
      <label class="field">
        <span class="field-label">What is it about? <span class="faint">(optional)</span></span>
        <textarea class="textarea" name="description" maxlength="2000"
          placeholder="A sentence or two so members know what they are joining.">${project?.description || ''}</textarea>
      </label>
      <label class="field">
        <span class="field-label">Time zone</span>
        <select class="select" name="timezone">
          ${zones.map((z) => html`<option value="${z}" ${z === zone ? html`selected` : ''}>${z.replace(/_/g, ' ')}</option>`)}
        </select>
        <span class="field-hint">Deadlines are set and shown in this time zone, wherever each person is.</span>
      </label>
      <p class="form-message" data-message hidden style="margin-top:var(--s-4)"></p>
      <div class="row" style="justify-content:flex-end;margin-top:var(--s-5)">
        <button class="btn btn-quiet" type="button" data-close>Cancel</button>
        <button class="btn" type="submit">${editing ? 'Save changes' : 'Create project'}</button>
      </div>
    </form>`,
    onMount(modal, close) {
      const form = modal.querySelector('form');
      const message = modal.querySelector('[data-message]');
      form.querySelector('[data-close]').addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = formValues(form);
        if (!values.name) {
          showFormMessage(message, 'Give the project a name.');
          form.name.focus();
          return;
        }
        const button = form.querySelector('[type="submit"]');
        setBusy(button, true);
        try {
          const fields = { name: values.name, description: values.description, timezone: values.timezone };
          const saved = editing ? await updateProject(project.id, fields) : await createProject(fields);
          close();
          if (editing) toast('Project saved');
          else flashNext('Project created');
          onSaved?.(saved);
        } catch (error) {
          showFormMessage(message, error.message);
          setBusy(button, false);
        }
      });
    },
  });
}
