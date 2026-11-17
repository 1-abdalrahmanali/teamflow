// Shows one version's content, whatever its type: code in a read-only editor,
// text as text, a file as a download. Submitted code is only ever shown, never run.
import { getFileUrl } from '../submissions/submissions.js';
import { $, html, icon, render, setBusy } from '../utils/dom.js';
import { languageLabel } from '../utils/constants.js';
import { copyText, createEditor } from './code-editor.js';
import { toast, toastError } from './toast.js';

// Returns a function that releases the editor, if one was created.
export async function renderSubmissionContent(container, { submission }) {
  const type = submission.submission_type;
  if (type === 'file') {
    render(
      container,
      html`<div class="card card-pad row row-wrap">
        <span class="empty-icon" style="margin:0">${icon('paperclip')}</span>
        <div class="grow"><p class="strong prewrap">${submission.file_name || 'Uploaded file'}</p>
          <p class="small faint">The download link is made when you click and works for five minutes.</p></div>
        <button class="btn" type="button" data-download>${icon('download')}Download file</button>
      </div>`,
    );
    $('[data-download]', container).addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        window.location.assign(await getFileUrl(submission.storage_path, submission.file_name));
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(button, false);
      }
    });
    return () => {};
  }

  const isCode = type === 'code';
  const content = isCode ? submission.code_content : submission.text_content;
  render(
    container,
    html`<div class="editor-frame">
      <div class="editor-bar">
        <span class="small strong">${isCode ? languageLabel(submission.language) : 'Written answer'}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-copy>${icon('copy')}Copy</button>
      </div>
      ${isCode
        ? html`<div class="editor-host" data-host></div>`
        : html`<div class="card-body prewrap answer-text">${content}</div>`}
    </div>`,
  );
  $('[data-copy]', container).addEventListener('click', async () => {
    const copied = await copyText(content || '');
    toast(copied ? 'Copied' : 'Copy failed. Select the text and copy it by hand.', copied ? 'good' : 'error');
  });
  if (!isCode) return () => {};
  const editor = await createEditor($('[data-host]', container), {
    value: content || '',
    language: submission.language,
    readOnly: true,
  });
  return () => editor.dispose();
}
