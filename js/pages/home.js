// app/home.html: sends each person to their own starting page.
import { isConfigured } from '../config/supabase.js';
import { homeFor, requireAccess } from '../auth/guards.js';
import { url } from '../utils/paths.js';

if (!isConfigured) {
  window.location.replace(url('index.html'));
} else {
  const access = await requireAccess();
  window.location.replace(homeFor(access));
}
