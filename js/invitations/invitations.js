// Invitation data. The database creates the secret token and returns it once;
// the administrator copies the link and sends it personally.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';
import { url } from '../utils/paths.js';

const COLUMNS = 'id, project_id, email, status, expires_at, created_at, invited_by';
const REMEMBER_KEY = 'teamflow.invitation';

export async function listInvitations(projectId) {
  let query = supabase
    .from('invitations')
    .select(`${COLUMNS}, project:projects(id, name)`)
    .order('created_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);
  return unwrap(await query);
}

// A pending invitation past its date is shown as expired even before the database marks it.
export function effectiveStatus(invitation) {
  return invitation.status === 'pending' && new Date(invitation.expires_at) <= new Date() ? 'expired' : invitation.status;
}

// The token travels in the URL fragment (after #), which browsers never send to a server.
export function invitationLink(token) {
  return `${url('accept-invitation.html')}#token=${encodeURIComponent(token)}`;
}

export async function createInvitation(projectId, email) {
  const result = unwrap(await supabase.rpc('create_invitation', { p_project_id: projectId, p_email: email }));
  return { ...result, link: invitationLink(result.token) };
}

export async function revokeInvitation(invitationId) {
  return unwrap(await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId }));
}

export async function getInvitationPreview(token) {
  return unwrap(await supabase.rpc('get_invitation', { p_token: token }));
}

export async function acceptInvitation(token) {
  return unwrap(await supabase.rpc('accept_invitation', { p_token: token }));
}

// While someone signs in or registers, the token waits in this browser's storage
// so the invitation can be finished afterwards without putting it in another URL.
export function rememberInvitation(token) {
  try {
    localStorage.setItem(REMEMBER_KEY, token);
  } catch {
    // Storage can be unavailable (private mode); the person can reopen the link instead.
  }
}

export function recallInvitation() {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

export function forgetInvitation() {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Nothing to clean up.
  }
}
