// Page guards. They only decide where to send someone; the database refuses anything
// a person is not allowed to do, whatever page they open.
import { getSession, signOut } from './auth.js';
import { loadAccess } from './access.js';
import { param, safeNext, url } from '../utils/paths.js';

const never = () => new Promise(() => {});

// Where a person lands after signing in.
export function homeFor(access) {
  if (access?.isAdmin) return url('app/admin/overview.html');
  if (access?.leadsAny) return url('app/leading.html');
  return url('app/dashboard.html');
}

export const defaultDestination = (access) => safeNext(param('next')) || homeFor(access);

// Resolves with the access model, or redirects and never resolves.
// need: null (any signed-in person), 'manager' (Platform Admin or any Team Leader), 'admin'.
export async function requireAccess({ need = null } = {}) {
  const session = await getSession();
  if (!session) {
    window.location.replace(url('login.html', { next: window.location.href }));
    return never();
  }
  let access = null;
  try {
    access = await loadAccess();
  } catch {
    access = null;
  }
  if (!access) {
    await signOut();
    window.location.replace(url('login.html', { expired: 1 }));
    return never();
  }
  const allowed = need === 'admin' ? access.isAdmin : need === 'manager' ? access.isManagerAnywhere : true;
  if (!allowed) {
    window.location.replace(homeFor(access));
    return never();
  }
  return access;
}

// For sign-in pages: someone already signed in goes straight to where they were headed.
export async function redirectIfSignedIn(destinationFor = defaultDestination) {
  const session = await getSession();
  if (!session) return false;
  const access = await loadAccess().catch(() => null);
  if (!access) return false;
  window.location.replace(destinationFor(access));
  return never();
}
