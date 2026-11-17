// Membership data. People join through invitations; Platform Admins change project
// roles and managers remove people, all through database functions.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

export async function listMembers(projectId) {
  let query = supabase
    .from('project_members')
    .select(
      'project_id, user_id, role, joined_at, user:profiles!project_members_user_id_fkey(id, full_name, email, avatar_url, platform_role), project:projects(id, name, status)',
    )
    .order('role', { ascending: false })
    .order('joined_at', { ascending: true });
  if (projectId) query = query.eq('project_id', projectId);
  return unwrap(await query);
}

export async function removeMember(projectId, userId) {
  return unwrap(await supabase.rpc('remove_member', { p_project_id: projectId, p_user_id: userId }));
}

// role: 'member' or 'team_leader'. Only a Platform Admin can do this.
export async function setProjectRole(projectId, userId, role) {
  return unwrap(await supabase.rpc('set_project_role', { p_project_id: projectId, p_user_id: userId, p_role: role }));
}
