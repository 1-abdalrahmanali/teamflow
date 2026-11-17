// Invitations. The send-invitation Edge Function creates the invitation as the
// signed-in person and emails the link through Resend. If the function is not
// deployed or cannot be reached, the app creates the invitation directly and shows
// the link to copy, so inviting never depends on email being set up.
import { supabase } from '../config/supabase.js';
import { AppError, friendly, unwrap } from '../utils/errors.js';
import { url } from '../utils/paths.js';

const COLUMNS = 'id, project_id, email, status, expires_at, created_at, invited_by';
const REMEMBER_KEY = 'teamflow.invitation';

export async function listInvitations(projectId) {
  let query = supabase
    .from('invitations')
    .select(`${COLUMNS}, project:projects(id, name, status), inviter:profiles!invitations_invited_by_fkey(id, full_name, avatar_url)`)
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

// What the function says when it refused the request on purpose (a 4xx with a message).
async function functionRefusal(error) {
  const response = error?.context;
  if (!response || typeof response.status !== 'number') return null;
  if (response.status < 400 || response.status >= 500 || response.status === 404) return null;
  try {
    const body = await response.clone().json();
    // The gateway's own "Invalid JWT" means the function is set up wrongly, not that the person was refused.
    if (body?.error && !/invalid jwt/i.test(body.error)) return body.error;
    if (body?.message && !/invalid jwt/i.test(body.message)) return body.message;
  } catch {
    // Not JSON: treat it as unreachable.
  }
  return null;
}

async function callFunction(body) {
  try {
    const { data, error } = await supabase.functions.invoke('send-invitation', { body });
    if (!error) return { ok: true, data };
    const refusal = await functionRefusal(error);
    if (refusal) throw new AppError(friendly({ message: refusal }));
    return { ok: false };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return { ok: false };
  }
}

function withLink(result, viaEmail) {
  return {
    invitationId: result.invitation_id,
    email: result.email,
    expiresAt: result.expires_at,
    link: invitationLink(result.token),
    emailSent: Boolean(viaEmail && result.email_sent),
    emailError: viaEmail ? result.email_error || null : 'Email is not available right now, so copy the link and send it yourself.',
  };
}

// Returns { invitationId, email, expiresAt, link, emailSent, emailError }.
export async function sendInvitation({ projectId, email }) {
  const sent = await callFunction({ project_id: projectId, email });
  if (sent.ok) return withLink(sent.data, true);
  const created = unwrap(await supabase.rpc('create_invitation', { p_project_id: projectId, p_email: email }));
  return withLink(created, false);
}

// Withdraws the old link and sends a fresh one (a new 7-day window).
export async function resendInvitation(invitationId) {
  const sent = await callFunction({ resend_invitation_id: invitationId });
  if (sent.ok) return withLink(sent.data, true);
  const created = unwrap(await supabase.rpc('resend_invitation', { p_invitation_id: invitationId }));
  return withLink(created, false);
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
