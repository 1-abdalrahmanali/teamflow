// Who the signed-in person is and what they may do. The sidebar and the buttons on
// every page are built from this. It decides what to show, never what is allowed:
// the database enforces every permission on its own.
import { supabase } from '../config/supabase.js';
import { getCurrentProfile } from './auth.js';
import { unwrap } from '../utils/errors.js';

let cached = null;

export async function loadAccess({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  const profile = await getCurrentProfile({ fresh });
  if (!profile) return null;

  const memberships = unwrap(
    await supabase
      .from('project_members')
      .select('project_id, role, joined_at, project:projects(id, name, status, timezone)')
      .eq('user_id', profile.id)
      .order('joined_at', { ascending: true }),
  );
  const roles = new Map(memberships.map((m) => [m.project_id, m.role]));
  const isAdmin = profile.platform_role === 'platform_admin';

  cached = {
    profile,
    isAdmin,
    memberships,
    memberOfAny: memberships.length > 0,
    leadsAny: memberships.some((m) => m.role === 'team_leader'),
    ledProjectIds: memberships.filter((m) => m.role === 'team_leader').map((m) => m.project_id),
    isManagerAnywhere: isAdmin || memberships.some((m) => m.role === 'team_leader'),
    roleIn: (projectId) => roles.get(projectId) || null,
    // Platform Admins manage every project; Team Leaders manage the ones they lead.
    canManage: (projectId) => isAdmin || roles.get(projectId) === 'team_leader',
  };
  return cached;
}

export function forgetAccess() {
  cached = null;
}
