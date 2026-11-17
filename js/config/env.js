// Public configuration for this deployment.
//
// Both values are safe to publish. The publishable key only identifies the
// project; Row Level Security in the database decides what each signed-in
// person can read or change.
//
// NEVER put a secret key (sb_secret_... or the legacy service_role key) here
// or anywhere else in this repository.

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_REPLACE_ME';
