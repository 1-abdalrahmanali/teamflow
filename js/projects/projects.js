// Project data: every Supabase call about projects, dashboard numbers and activity.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

const COLUMNS = 'id, name, description, status, owner_id, created_at, updated_at';
const OWNER = 'owner:profiles!projects_owner_id_fkey(id, full_name, avatar_url, email)';

export async function listProjects() {
  return unwrap(
    await supabase
      .from('projects')
      .select(`${COLUMNS}, ${OWNER}, tasks(count), project_members(count)`)
      .order('created_at', { ascending: false }),
  );
}

export async function getProject(id) {
  return unwrap(await supabase.from('projects').select(`${COLUMNS}, ${OWNER}`).eq('id', id).maybeSingle());
}

export async function createProject({ name, description }) {
  return unwrap(await supabase.from('projects').insert({ name, description }).select(COLUMNS).single());
}

// patch may hold name, description and status; the database rejects anything else.
export async function updateProject(id, patch) {
  return unwrap(await supabase.from('projects').update(patch).eq('id', id).select(COLUMNS).single());
}

export async function deleteProject(id) {
  return unwrap(await supabase.from('projects').delete().eq('id', id));
}

export async function getDashboardStats() {
  return unwrap(await supabase.rpc('dashboard_stats'));
}

export async function listActivity({ projectId, limit = 12 } = {}) {
  let query = supabase
    .from('activity_logs')
    .select(
      'id, action, entity_type, entity_id, metadata, created_at, project_id, actor:profiles!activity_logs_user_id_fkey(id, full_name, avatar_url), project:projects(id, name)',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (projectId) query = query.eq('project_id', projectId);
  return unwrap(await query);
}

// One activity row as a short sentence, e.g. "submitted version 2 of Build the login page".
export function describeActivity(entry) {
  const meta = entry.metadata || {};
  const title = meta.title ? `"${meta.title}"` : 'a task';
  const phrases = {
    'project.created': `created the project ${meta.name ? `"${meta.name}"` : ''}`,
    'project.archived': 'archived the project',
    'project.restored': 'restored the project',
    'invitation.created': `invited ${meta.email || 'someone'}`,
    'invitation.revoked': `withdrew the invitation for ${meta.email || 'someone'}`,
    'member.joined': 'joined the project',
    'member.removed': `removed ${meta.name || 'a member'} from the project`,
    'task.created': `created ${title}`,
    'task.assigned': `assigned ${title}`,
    'task.deleted': `deleted ${title}`,
    'task.started': `started ${title}`,
    'submission.submitted': `submitted version ${meta.version || ''} of ${title}`,
    'submission.approved': `approved version ${meta.version || ''} of ${title}`,
    'submission.revision_requested': `asked for changes to version ${meta.version || ''} of ${title}`,
  };
  return (phrases[entry.action] || entry.action).trim();
}
