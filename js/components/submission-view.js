// Shows one submission's content, whatever its type: code in a read-only editor,
// text as text, a GitHub link as a link, a file as a download.
import { getFileUrl } from '../submissions/submissions.js';
import { $, html, icon, render, safeLink, setBusy } from '../utils/dom.js';
import { languageLabel } from '../utils/constants.js';
import { copyText, createEditor } from './code-editor.js';
import { toast, toastError } from './toast.js';

// Returns a function that releases the editor, if one was created.
export async function renderSubmissionContent(container, { submission, type }) {
  if (type === 'file_upload') {
    render(
      container,
      html`<div class="card card-pad row row-wrap">
        <span class="empty-icon" style="margin:0">${icon('paperclip')}</span>
        <div class="grow"><p class="strong prewrap">${submission.file_name || 'Uploaded file'}</p>
          <p class="small faint">The download link is created when you click and works for five minutes.</p></div>
        <button class="btn" type="button" data-download>${icon('download')}Download file</button>
      </div>`,
    );
    $('[data-download]', container).addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        window.open(await getFileUrl(submission.file_path), '_blank', 'noopener');
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(button, false);
      }
    });
    return () => {};
  }

  if (type === 'github_link') {
    render(
      container,
      html`<div class="card card-pad row row-wrap">
        <span class="empty-icon" style="margin:0">${icon('git-branch')}</span>
        <div class="grow"><p class="small faint">Repository</p><p class="strong mono prewrap">${submission.code}</p></div>
        <a class="btn" href="${safeLink(submission.code)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}Open on GitHub</a>
      </div>`,
    );
    return () => {};
  }

  const isCode = type === 'code';
  render(
    container,
    html`<div class="editor-frame">
      <div class="editor-bar">
        <span class="small strong">${isCode ? languageLabel(submission.language) : 'Written answer'}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-copy>${icon('copy')}Copy</button>
      </div>
      ${isCode ? html`<div class="editor-host" data-host></div>` : html`<div class="card-body prewrap" style="max-height:480px;overflow:auto">${submission.code}</div>`}
    </div>`,
  );
  $('[data-copy]', container).addEventListener('click', async () => {
    toast((await copyText(submission.code || '')) ? 'Copied' : 'Copy failed', 'good');
  });
  if (!isCode) return () => {};
  const editor = await createEditor($('[data-host]', container), {
    value: submission.code || '',
    language: submission.language,
    readOnly: true,
  });
  return () => editor.dispose();
}
