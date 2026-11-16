// Turns Supabase errors into sentences a person can act on.
// The database functions already raise plain-language messages; those pass through unchanged.

export class AppError extends Error {}

const KNOWN = [
  [/invalid login credentials/i, 'That email and password do not match. Check them and try again.'],
  [/email not confirmed/i, 'Confirm your email first. The link is in the message we sent you.'],
  [/user already registered/i, 'There is already an account with that email. Sign in instead.'],
  [/rate limit|too many requests/i, 'Too many attempts. Wait a minute, then try again.'],
  [/failed to fetch|networkerror|load failed/i, 'Cannot reach the server. Check your connection and try again.'],
  [/jwt expired|session.*(missing|not.?found)|refresh.?token/i, 'Your session has ended. Sign in again.'],
  [/tasks_assignee_is_project_member/i, 'That person is not a member of this project.'],
  [/row-level security|permission denied/i, 'You do not have permission to do that.'],
  [/exceeded the maximum allowed size|payload too large/i, 'That file is too large.'],
  [/duplicate key/i, 'That already exists.'],
  [/json object requested|0 rows|PGRST116/i, 'That item no longer exists, or you do not have access to it.'],
];

export function friendly(error) {
  const message = error?.message || String(error || '');
  for (const [pattern, text] of KNOWN) {
    if (pattern.test(message)) return text;
  }
  return message || 'Something went wrong. Try again.';
}

// Every Supabase call goes through here, so no error is ever silently dropped.
export function unwrap({ data, error }) {
  if (error) throw new AppError(friendly(error));
  return data;
}
