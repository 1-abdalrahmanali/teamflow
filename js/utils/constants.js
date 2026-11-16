// The app's vocabulary in one place. The keys match the values the database stores.

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
  revision_requested: { label: 'Revision requested', tone: 'red' },
};

export const INVITATION_STATUS = {
  pending: { label: 'Pending', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'green' },
  expired: { label: 'Expired', tone: '' },
  revoked: { label: 'Revoked', tone: 'red' },
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
  text: { label: 'Text', icon: 'file-text', hint: 'A written answer.' },
  github_link: { label: 'GitHub link', icon: 'git-branch', hint: 'A link to a GitHub repository.' },
  file_upload: { label: 'File upload', icon: 'paperclip', hint: 'One file, up to 10 MB.' },
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MIN_PASSWORD_LENGTH = 8;
