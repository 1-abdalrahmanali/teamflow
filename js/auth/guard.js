// Page guards. These only decide where to send someone; they are a courtesy,
// not security. The database refuses anything a person is not allowed to do.
import { getCurrentProfile, getSession, signOut } from './auth.js';
import { param, safeNext, url } from '../utils/paths.js';

const never = () => new Promise(() => {});

export function homeFor(profile) {
  return url(profile?.platform_role === 'administrator' ? 'admin/dashboard.html' : 'member/dashboard.html');
}

// Resolves with the profile, or redirects and never resolves.
export async function requireProfile({ adminOnly = false } = {}) {
  const session = await getSession();
  if (!session) {
    window.location.replace(url('login.html', { next: window.location.href }));
    return never();
  }
  let profile = null;
  try {
    profile = await getCurrentProfile();
  } catch {
    profile = null;
  }
  if (!profile) {
    await signOut();
    window.location.replace(url('login.html', { expired: 1 }));
    return never();
  }
  if (adminOnly && profile.platform_role !== 'administrator') {
    window.location.replace(homeFor(profile));
    return never();
  }
  return profile;
}

export const defaultDestination = (profile) => safeNext(param('next')) || homeFor(profile);

// For sign-in pages: someone already signed in goes straight to where they were headed.
export async function redirectIfSignedIn(destinationFor = defaultDestination) {
  const session = await getSession();
  if (!session) return false;
  const profile = await getCurrentProfile().catch(() => null);
  if (!profile) return false;
  window.location.replace(destinationFor(profile));
  return never();
}
