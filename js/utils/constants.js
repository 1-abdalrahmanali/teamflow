// The app's vocabulary in one place. Keys match the values the database stores.

export const PLATFORM_ROLES = {
  user: { label: 'User' },
  platform_admin: { label: 'Platform Admin' },
};

export const PROJECT_ROLES = {
  member: { label: 'Member' },
  team_leader: { label: 'Team Leader' },
};

export const TASK_STATUS = {
  todo: { label: 'To do', tone: '' },
  in_progress: { label: 'In progress', tone: 'indigo' },
  submitted: { label: 'Submitted', tone: 'amber' },
  revision_required: { label: 'Revision required', tone: 'red' },
  completed: { label: 'Completed', tone: 'green' },
};

export const REVIEW_STATUS = {
  pending: { label: 'Waiting for review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  revision_requested: { label: 'Changes requested', tone: 'red' },
};

export const INVITATION_STATUS = {
  pending: { label: 'Pending', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'green' },
  expired: { label: 'Expired', tone: '' },
  revoked: { label: 'Withdrawn', tone: 'red' },
};

export const PRIORITY = {
  low: { label: 'Low' },
  medium: { label: 'Medium' },
  high: { label: 'High' },
};

// value = what the database stores; monaco = the editor's language id.
export const LANGUAGES = [
  { value: 'html', label: 'HTML', monaco: 'html' },
  { value: 'css', label: 'CSS', monaco: 'css' },
  { value: 'javascript', label: 'JavaScript', monaco: 'javascript' },
  { value: 'typescript', label: 'TypeScript', monaco: 'typescript' },
  { value: 'python', label: 'Python', monaco: 'python' },
  { value: 'cpp', label: 'C++', monaco: 'cpp' },
  { value: 'java', label: 'Java', monaco: 'java' },
  { value: 'sql', label: 'SQL', monaco: 'sql' },
];

export const languageLabel = (value) => LANGUAGES.find((item) => item.value === value)?.label || 'Plain text';

export const SUBMISSION_TYPES = {
  code: { label: 'Code', icon: 'code', hint: 'Written in the built-in editor.' },
  text: { label: 'Written answer', icon: 'file-text', hint: 'A text response.' },
  file: { label: 'File upload', icon: 'paperclip', hint: 'One file, up to 10 MB.' },
};

// Extensions accepted for submission files, and the content type each is uploaded with.
export const SUBMISSION_FILE_TYPES = {
  zip: 'application/zip', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  html: 'text/html', css: 'text/css', js: 'text/javascript', ts: 'text/plain', py: 'text/plain', java: 'text/plain',
  cpp: 'text/plain', c: 'text/plain', h: 'text/plain', sql: 'text/plain',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// The upload content type for each extension a resource file may have. The bucket only
// accepts these types, and the database checks the extension against the resource type.
const RESOURCE_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  zip: 'application/zip', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', py: 'text/plain',
  html: 'text/html', css: 'text/css', java: 'text/plain', cpp: 'text/plain', c: 'text/plain', h: 'text/plain',
  hpp: 'text/plain', sql: 'text/plain', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export const resourceMime = (ext) => RESOURCE_MIME[ext] || null;

export const RESOURCE_TYPES = {
  youtube: { label: 'YouTube video', icon: 'circle-play', kind: 'link', hint: 'A youtube.com or youtu.be link.' },
  documentation: { label: 'Documentation', icon: 'book-open', kind: 'link', hint: 'Official docs or a reference page.' },
  article: { label: 'Article', icon: 'newspaper', kind: 'link', hint: 'A blog post or tutorial.' },
  reference_project: { label: 'Reference project', icon: 'box', kind: 'link', hint: 'A link to an example project.' },
  pdf: { label: 'PDF', icon: 'file-text', kind: 'file', exts: ['pdf'] },
  image: { label: 'Image', icon: 'image', kind: 'file', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
  starter_code: {
    label: 'Starter code', icon: 'file-code', kind: 'file',
    exts: ['zip', 'js', 'mjs', 'ts', 'py', 'html', 'css', 'java', 'cpp', 'c', 'h', 'hpp', 'sql', 'txt', 'md', 'json'],
  },
  document: { label: 'Other document', icon: 'file', kind: 'file', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'zip'] },
};

export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;
export const MAX_RESOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MIN_PASSWORD_LENGTH = 8;

export const fileExtension = (name) => (/\.([A-Za-z0-9]+)$/.exec(String(name || ''))?.[1] || '').toLowerCase();
