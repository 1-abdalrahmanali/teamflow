// Deadlines live in the project's time zone. These helpers convert between what a
// person types or reads in that zone and the UTC instant the database stores,
// without any library and without depending on the browser's own zone.

const PARTS = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { ...PARTS, timeZone }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

// Minutes the zone is ahead of UTC at that instant (Cairo in November: 120).
export function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60000);
}

// '2026-11-20T23:30' typed in Africa/Cairo -> the Date for 2026-11-20T21:30:00Z.
export function zonedToUtc(localValue, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(localValue || ''));
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset even when the wall time sits next to a clock change.
  let instant = wall - offsetMinutes(new Date(wall), timeZone) * 60000;
  instant = wall - offsetMinutes(new Date(instant), timeZone) * 60000;
  return new Date(instant);
}

const pad = (n) => String(n).padStart(2, '0');

// The value an <input type="datetime-local"> needs to show a stored deadline in the project's zone.
export function utcToZonedInput(value, timeZone) {
  if (!value) return '';
  const p = zonedParts(new Date(value), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// "Cairo" for Africa/Cairo, "New York" for America/New_York, "UTC" for UTC.
export function zoneLabel(timeZone) {
  if (!timeZone || timeZone === 'UTC' || timeZone === 'Etc/UTC') return 'UTC';
  return timeZone.split('/').pop().replace(/_/g, ' ');
}

export function formatInZone(value, timeZone, { withZone = true, withTime = true } = {}) {
  if (!value) return '';
  const text = new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(value));
  return withZone ? `${text} (${zoneLabel(timeZone)} time)` : text;
}

function spell(ms) {
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export const DUE_SOON_HOURS = 48;

// The deadline in words, with a tone for colour. Completed work is never overdue.
// tone: 'late' (overdue), 'soon' (within 48 hours) or '' (fine, done, or no deadline).
export function deadlineInfo(deadline, status, timeZone, now = Date.now()) {
  if (!deadline) return { label: 'No deadline', remaining: '', tone: '' };
  const due = new Date(deadline).getTime();
  const when = formatInZone(deadline, timeZone, { withZone: false });
  if (status === 'completed') return { label: `Was due ${when}`, remaining: '', tone: '' };
  const left = due - now;
  if (left < 0) return { label: `Due ${when}`, remaining: `Overdue by ${spell(left)}`, tone: 'late' };
  return {
    label: `Due ${when}`,
    remaining: `${spell(left)} left`,
    tone: left <= DUE_SOON_HOURS * 3600000 ? 'soon' : '',
  };
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function allTimeZones() {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return ['UTC', 'Africa/Cairo', 'Europe/London', 'America/New_York', 'Asia/Dubai'];
  }
}
