// Everyone on the platform, for the Users and roles page (Platform Admins only).
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

export async function listUsers() {
  return unwrap(
    await supabase
      .from('profiles')
      .select(
        'id, full_name, email, avatar_url, platform_role, created_at, memberships:project_members!project_members_user_id_fkey(role, project:projects(id, name, status))',
      )
      .order('platform_role', { ascending: true })
      .order('full_name', { ascending: true }),
  );
}

// role: 'user' or 'platform_admin'. Nobody can change their own role.
export async function setPlatformRole(userId, role) {
  return unwrap(await supabase.rpc('set_platform_role', { p_user_id: userId, p_role: role }));
}

export async function listRoleChanges(limit = 20) {
  return unwrap(
    await supabase
      .from('activity_logs')
      .select('id, action, metadata, created_at, project:projects(id, name), actor:profiles!activity_logs_user_id_fkey(id, full_name, avatar_url)')
      .in('action', ['role.platform_changed', 'role.project_changed'])
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}
