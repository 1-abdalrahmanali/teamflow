// The one Supabase client the whole app shares.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './env.js';

// True once js/config/env.js holds real values instead of the placeholders.
export const isConfigured =
  !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_PUBLISHABLE_KEY.includes('REPLACE_ME');

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : 'https://not-configured.invalid',
  isConfigured ? SUPABASE_PUBLISHABLE_KEY : 'not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
