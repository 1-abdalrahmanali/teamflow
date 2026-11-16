// Dates, names and small bits of wording.

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDate(value) {
  return value ? dateFormat.format(new Date(value)) : '';
}

export function formatDateTime(value) {
  return value ? dateTimeFormat.format(new Date(value)) : '';
}

export function timeAgo(value) {
  if (!value) return '';
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const steps = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

// A deadline in words, with a tone the task rows use for colour.
export function deadlineInfo(deadline, status) {
  if (!deadline) return { label: 'No deadline', tone: '' };
  const due = new Date(deadline);
  if (status === 'completed') return { label: `Was due ${formatDate(due)}`, tone: '' };
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: `Overdue since ${formatDate(due)}`, tone: 'late' };
  if (days === 0) return { label: 'Due today', tone: 'soon' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'soon' };
  if (days <= 3) return { label: `Due in ${days} days`, tone: 'soon' };
  return { label: `Due ${formatDate(due)}`, tone: '' };
}

export function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'there';
}

export function initials(fullName) {
  const parts = String(fullName || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// The same person always gets the same avatar colour.
export function hueFor(text) {
  let sum = 0;
  for (const char of String(text || '')) sum = (sum + char.charCodeAt(0)) % 997;
  return (sum % 6) + 1;
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

// For <input type="datetime-local">, which wants local time without a zone.
export function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
