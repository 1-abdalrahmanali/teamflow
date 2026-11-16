// Monaco Editor, loaded from the CDN the first time a page needs it.
// If the editor cannot load, a plain text box takes its place so nobody is
// blocked from submitting.
import { LANGUAGES } from '../utils/constants.js';

const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
const FORMATTABLE = new Set(['html', 'css', 'javascript', 'typescript', 'json']);
let monacoPromise;

export function monacoLanguage(value) {
  return LANGUAGES.find((item) => item.value === value)?.monaco || 'plaintext';
}

export function canFormat(value) {
  return FORMATTABLE.has(monacoLanguage(value));
}

function loadMonaco() {
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    // Browsers only start workers from the page's own origin, so the CDN worker
    // is wrapped in a small same-origin script.
    const workerSource = `self.MonacoEnvironment = { baseUrl: '${MONACO_BASE}/' }; importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`;
    window.MonacoEnvironment = {
      getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(workerSource)}`,
    };
    const script = document.createElement('script');
    script.src = `${MONACO_BASE}/vs/loader.js`;
    script.onload = () => {
      window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    script.onerror = () => reject(new Error('The code editor could not be loaded.'));
    document.head.append(script);
  });
  return monacoPromise;
}

function plainEditor(host, { value, readOnly }) {
  const area = document.createElement('textarea');
  area.className = 'textarea mono';
  area.style.cssText = 'height:100%;border:0;border-radius:0;resize:none;white-space:pre;tab-size:2';
  area.value = value;
  area.readOnly = readOnly;
  area.spellcheck = false;
  area.setAttribute('aria-label', 'Code');
  host.replaceChildren(area);
  return {
    isFallback: true,
    getValue: () => area.value,
    setValue: (next) => { area.value = next; },
    setLanguage: () => {},
    format: async () => {},
    onChange: (callback) => area.addEventListener('input', callback),
    focus: () => area.focus(),
    dispose: () => area.remove(),
  };
}

// Returns a small, uniform editor object whichever editor ends up on the page.
export async function createEditor(host, { value = '', language = '', readOnly = false } = {}) {
  let monaco;
  try {
    monaco = await loadMonaco();
  } catch {
    return plainEditor(host, { value, readOnly });
  }
  host.replaceChildren();
  const editor = monaco.editor.create(host, {
    value,
    language: monacoLanguage(language),
    readOnly,
    domReadOnly: readOnly,
    theme: 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbers: 'on',
    fontSize: 14,
    fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: false,
    autoIndent: 'full',
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    renderLineHighlight: readOnly ? 'none' : 'line',
    padding: { top: 12, bottom: 12 },
    ariaLabel: readOnly ? 'Submitted code' : 'Code editor',
  });
  return {
    isFallback: false,
    getValue: () => editor.getValue(),
    setValue: (next) => editor.setValue(next),
    setLanguage: (next) => monaco.editor.setModelLanguage(editor.getModel(), monacoLanguage(next)),
    format: async () => {
      await editor.getAction('editor.action.formatDocument')?.run();
    },
    onChange: (callback) => editor.onDidChangeModelContent(callback),
    focus: () => editor.focus(),
    dispose: () => editor.dispose(),
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure pages: fall back to a temporary text box.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}
