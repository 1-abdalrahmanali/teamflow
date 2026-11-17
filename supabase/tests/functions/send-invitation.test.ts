// Tests for the send-invitation Edge Function, run against a local Supabase stack
// (`supabase start`) with a stand-in for the Resend API.
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_JWT_SECRET=... \
//   deno run --allow-net --allow-env supabase/tests/functions/send-invitation.test.ts
//
// WARNING: creates users and a project in the target database. Use a local stack only.

import { handleInvitation } from '../../functions/send-invitation/handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') ?? '';
if (!ANON_KEY || !JWT_SECRET) throw new Error('Set SUPABASE_ANON_KEY and SUPABASE_JWT_SECRET (see `supabase status`).');

// ---------------------------------------------------------------- a stand-in for Resend
const sent: Array<{ to: string[]; subject: string; html: string; text: string; from: string }> = [];
const fakeResend = Deno.serve({ port: 54399, onListen: () => {} }, async (req) => {
  const email = await req.json();
  if (email.to.some((to: string) => to.startsWith('bounce'))) return new Response('{"message":"rejected"}', { status: 422 });
  sent.push(email);
  return Response.json({ id: crypto.randomUUID() });
});

Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_ANON_KEY', ANON_KEY);
Deno.env.set('RESEND_API_KEY', 're_test');
Deno.env.set('INVITE_FROM', 'TeamFlow <invites@example.com>');
Deno.env.set('APP_URL', 'https://teamflow.example.com/');
Deno.env.set('RESEND_API_URL', 'http://localhost:54399/emails');

// ---------------------------------------------------------------- helpers
let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function serviceToken() {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const head = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ role: 'service_role', iss: 'supabase', iat: 1700000000, exp: 2000000000 })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(head)));
  return `${head}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}
const SERVICE = await serviceToken();

async function signUp(email: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-42', data: { full_name: email.split('@')[0] } }),
  });
  const body = await res.json();
  assert(body.access_token, `sign-up for ${email} returned no session: ${JSON.stringify(body)}`);
  return { token: body.access_token as string, id: body.user.id as string };
}

async function rest(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function invoke(token: string | null, body: unknown, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: ANON_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  return handleInvitation(new Request('http://local/functions/v1/send-invitation', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }));
}

// ---------------------------------------------------------------- setup
const run = Date.now();
const admin = await signUp(`fn-admin-${run}@example.com`);
const outsider = await signUp(`fn-outsider-${run}@example.com`);
await rest(SERVICE, `profiles?id=eq.${admin.id}`, { method: 'PATCH', body: JSON.stringify({ platform_role: 'platform_admin' }) });
const [project] = await rest(admin.token, 'projects', { method: 'POST', body: JSON.stringify({ name: 'Function <test> & co', timezone: 'UTC' }) });

console.log('\nsend-invitation');
let firstInvitation = '';

await test('a manager invites, and the email carries a working link', async () => {
  const res = await invoke(admin.token, { project_id: project.id, email: `New.Person-${run}@Example.com` });
  const body = await res.json();
  assert(res.status === 200 && body.email_sent === true, `got ${res.status} ${JSON.stringify(body)}`);
  assert(/^[0-9a-f]{64}$/.test(body.token), 'the token comes back for the copy-link backup');
  firstInvitation = body.invitation_id;
  const email = sent.at(-1)!;
  assert(email.to[0] === `new.person-${run}@example.com`, `sent to ${email.to}`);
  assert(email.html.includes(`https://teamflow.example.com/accept-invitation.html#token=${body.token}`), 'link in the HTML');
  assert(email.text.includes(`#token=${body.token}`), 'link in the text version');
  assert(email.html.includes('Function &lt;test&gt; &amp; co') && !email.html.includes('<test>'), 'project name escaped');
  assert(email.subject.includes('Function <test> & co'), 'subject names the project');
});

await test('someone who does not manage the project gets the database\'s refusal', async () => {
  const res = await invoke(outsider.token, { project_id: project.id, email: 'x@example.com' });
  const body = await res.json();
  assert(res.status === 400 && /manage this project/.test(body.error), JSON.stringify(body));
});

await test('no sign-in, no invitation', async () => {
  const res = await invoke(null, { project_id: project.id, email: 'x@example.com' });
  assert(res.status === 401, `status ${res.status}`);
});

await test('if Resend refuses the email, the invitation still exists and the link comes back', async () => {
  const res = await invoke(admin.token, { project_id: project.id, email: `bounce-${run}@example.com` });
  const body = await res.json();
  assert(body.email_sent === false && /copy the link/.test(body.email_error) && body.token, JSON.stringify(body));
});

await test('sending again replaces the link and emails the new one', async () => {
  const before = sent.length;
  const res = await invoke(admin.token, { resend_invitation_id: firstInvitation });
  const body = await res.json();
  assert(body.email_sent === true && body.invitation_id !== firstInvitation, JSON.stringify(body));
  assert(sent.length === before + 1 && sent.at(-1)!.html.includes(body.token), 'a new email with the new token');
});

await test('without email settings the invitation still works through copy-link', async () => {
  Deno.env.delete('RESEND_API_KEY');
  const res = await invoke(admin.token, { project_id: project.id, email: `later-${run}@example.com` });
  const body = await res.json();
  Deno.env.set('RESEND_API_KEY', 're_test');
  assert(body.email_sent === false && /not set up/.test(body.email_error) && body.token, JSON.stringify(body));
});

await test('browsers get CORS headers on the preflight', async () => {
  const res = await invoke(null, null, 'OPTIONS');
  assert(res.status === 200 && res.headers.get('Access-Control-Allow-Origin') === '*', `status ${res.status}`);
});

await fakeResend.shutdown();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
