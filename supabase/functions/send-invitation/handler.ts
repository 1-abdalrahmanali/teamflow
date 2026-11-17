// send-invitation: creates a project invitation as the signed-in inviter and emails
// the link through Resend.
//
// The function never holds a key that can bypass row level security. It calls the
// database with the inviter's own sign-in, so create_invitation and resend_invitation
// make every permission check. The only secret it holds is the Resend API key.
//
// Request (POST, JSON):  { "project_id": "...", "email": "..." }   or   { "resend_invitation_id": "..." }
// Response (JSON):       { invitation_id, email, expires_at, token, email_sent, email_error? }
//
// Secrets: RESEND_API_KEY, INVITE_FROM (e.g. "TeamFlow <invites@yourdomain.com>"), APP_URL
// (the live site, e.g. "https://name.github.io/teamflow"). RESEND_API_URL is only for tests.
// Supabase provides SUPABASE_URL and SUPABASE_ANON_KEY automatically.

import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { invitationEmail } from './email.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const COPY_LINK = 'copy the link and send it yourself';

export async function handleInvitation(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'Sign in to send invitations.' });

  let body: { project_id?: string; email?: string; resend_invitation_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Send the invitation details as JSON.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey');
  if (!supabaseUrl || !anonKey) return json(500, { error: 'The function is missing its Supabase settings.' });

  // Acts as the inviter, never as an administrator.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = body.resend_invitation_id
    ? await supabase.rpc('resend_invitation', { p_invitation_id: body.resend_invitation_id })
    : await supabase.rpc('create_invitation', { p_project_id: body.project_id ?? null, p_email: body.email ?? null });
  if (error) return json(400, { error: error.message });

  const result = {
    invitation_id: data.invitation_id,
    email: data.email,
    expires_at: data.expires_at,
    token: data.token,
    email_sent: false,
  };

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITE_FROM');
  const appUrl = Deno.env.get('APP_URL');
  if (!apiKey || !from || !appUrl) {
    return json(200, { ...result, email_error: `Invitation emails are not set up yet, so ${COPY_LINK}.` });
  }

  const link = `${appUrl.replace(/\/+$/, '')}/accept-invitation.html#token=${encodeURIComponent(data.token)}`;
  const message = invitationEmail({
    projectName: data.project_name,
    inviterName: data.inviter_name,
    email: data.email,
    expiresAt: data.expires_at,
    link,
  });

  try {
    const response = await fetch(Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [data.email], subject: message.subject, html: message.html, text: message.text }),
    });
    if (!response.ok) {
      console.error('Resend refused the invitation email', response.status, await response.text());
      return json(200, { ...result, email_error: `The email could not be sent, so ${COPY_LINK}.` });
    }
  } catch (cause) {
    console.error('Could not reach Resend', cause);
    return json(200, { ...result, email_error: `The email service could not be reached, so ${COPY_LINK}.` });
  }

  return json(200, { ...result, email_sent: true });
}
