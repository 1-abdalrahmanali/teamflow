// Sign-up, sign-in, sessions and the signed-in person's profile.
// Passwords go straight to Supabase Auth; this app never stores or sees them afterwards.
import { supabase } from '../config/supabase.js';
import { AppError, friendly, unwrap } from '../utils/errors.js';
import { url } from '../utils/paths.js';
import { MAX_AVATAR_BYTES } from '../utils/constants.js';

const PROFILE_COLUMNS = 'id, full_name, email, avatar_url, platform_role';
let cachedProfile = null;

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  return error ? null : data.session;
}

export async function signUp({ fullName, email, password, next }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: url('login.html', { confirmed: 1, next }),
    },
  });
  if (error) throw new AppError(friendly(error));
  // When email confirmation is on, Supabase answers a repeat sign-up with a
  // look-alike user that has no identities instead of an error.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new AppError('There is already an account with that email. Sign in instead.');
  }
  return { needsConfirmation: !data.session };
}

export async function signIn(email, password) {
  cachedProfile = null;
  unwrap(await supabase.auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  cachedProfile = null;
  await supabase.auth.signOut();
}

export async function sendPasswordReset(email) {
  unwrap(await supabase.auth.resetPasswordForEmail(email, { redirectTo: url('reset-password.html') }));
}

export async function updatePassword(password) {
  unwrap(await supabase.auth.updateUser({ password }));
}

export async function getCurrentProfile({ fresh = false } = {}) {
  if (cachedProfile && !fresh) return cachedProfile;
  const session = await getSession();
  if (!session) return null;
  cachedProfile = unwrap(
    await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', session.user.id).maybeSingle(),
  );
  return cachedProfile;
}

// Only the name and avatar can change; the database refuses anything else.
export async function updateProfile(patch) {
  const profile = await getCurrentProfile();
  cachedProfile = unwrap(
    await supabase.from('profiles').update(patch).eq('id', profile.id).select(PROFILE_COLUMNS).single(),
  );
  return cachedProfile;
}

export async function uploadAvatar(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new AppError('Choose a PNG, JPG or WebP image.');
  if (file.size > MAX_AVATAR_BYTES) throw new AppError('Choose an image under 2 MB.');
  const profile = await getCurrentProfile();
  const extension = file.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${profile.id}/avatar-${Date.now()}.${extension}`;
  unwrap(await supabase.storage.from('avatars').upload(path, file, { contentType: file.type }));
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return updateProfile({ avatar_url: data.publicUrl });
}

// Runs the callback when the session ends, including in another tab.
export function onSignedOut(callback) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback();
  });
}
