// The invitation email, as HTML and plain text. Every value from the database is escaped.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

interface InvitationDetails {
  projectName: string;
  inviterName: string;
  email: string;
  expiresAt: string;
  link: string;
}

export function invitationEmail({ projectName, inviterName, email, expiresAt, link }: InvitationDetails) {
  const until = new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const inviter = inviterName || 'A project manager';
  const subject = `${inviter} invited you to ${projectName} on TeamFlow`;

  const text = [
    `${inviter} invited you to join "${projectName}" on TeamFlow.`,
    '',
    `Open this link to accept: ${link}`,
    '',
    `Sign in or create your account with ${email}. The link works once, until ${until}.`,
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1d2130">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e5eb;border-radius:12px">
      <tr><td style="padding:28px">
        <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#4338ca">TeamFlow</p>
        <h1 style="margin:0 0 12px;font-size:20px">Join ${escapeHtml(projectName)}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escapeHtml(inviter)} invited you to work on this project with them.</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#4338ca;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600">Accept the invitation</a></p>
        <p style="margin:0 0 8px;font-size:13px;color:#4a5165">Sign in or create your account with <strong>${escapeHtml(email)}</strong>. The link works once, until ${escapeHtml(until)}.</p>
        <p style="margin:0;font-size:13px;color:#7b8296">If you were not expecting this, you can ignore this email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, text, html };
}
