// Project data: every Supabase call about projects and the activity feed.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

const COLUMNS = 'id, name, description, status, timezone, created_by, created_at, updated_at';
const CREATOR = 'creator:profiles!projects_created_by_fkey(id, full_name, avatar_url)';

// Platform Admins see every project; everyone else sees the projects they belong to.
export async function listProjects() {
  return unwrap(
    await supabase
      .from('projects')
      .select(`${COLUMNS}, ${CREATOR}, project_members(count)`)
      .order('status', { ascending: true })
      .order('created_at', { ascending: false }),
  );
}

export async function getProject(id) {
  return unwrap(await supabase.from('projects').select(`${COLUMNS}, ${CREATOR}`).eq('id', id).maybeSingle());
}

export async function createProject({ name, description, timezone }) {
  return unwrap(await supabase.from('projects').insert({ name, description, timezone }).select(COLUMNS).single());
}

// patch may hold name, description, timezone and status; the database refuses anything else.
export async function updateProject(id, patch) {
  return unwrap(await supabase.from('projects').update(patch).eq('id', id).select(COLUMNS).single());
}

export async function deleteProject(id) {
  return unwrap(await supabase.from('projects').delete().eq('id', id));
}

// Task counts per status for one project, from the tasks this person can see.
export async function projectTaskCounts(projectId) {
  const rows = unwrap(await supabase.from('tasks').select('status').eq('project_id', projectId));
  const counts = { total: rows.length, todo: 0, in_progress: 0, submitted: 0, revision_required: 0, completed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
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

const ROLE_WORDS = { user: 'User', platform_admin: 'Platform Admin', member: 'Member', team_leader: 'Team Leader' };

// One activity row as a short sentence, e.g. "submitted version 2 of "Build the login page"".
export function describeActivity(entry) {
  const meta = entry.metadata || {};
  const title = meta.title ? `"${meta.title}"` : 'a task';
  const who = meta.name || 'someone';
  const phrases = {
    'project.created': `created the project ${meta.name ? `"${meta.name}"` : ''}`,
    'project.updated': 'updated the project details',
    'project.archived': 'archived the project',
    'project.restored': 'restored the project',
    'invitation.created': `invited ${meta.email || 'someone'}`,
    'invitation.revoked': `withdrew the invitation for ${meta.email || 'someone'}`,
    'member.joined': 'joined the project',
    'member.removed': `removed ${who} from the project`,
    'role.platform_changed': `made ${who} ${ROLE_WORDS[meta.to] === 'User' ? 'a regular user' : `a ${ROLE_WORDS[meta.to] || meta.to}`}`,
    'role.project_changed': `made ${who} a ${ROLE_WORDS[meta.to] || meta.to}`,
    'task.created': `created ${title}`,
    'task.assigned': `assigned ${title}`,
    'task.unassigned': `unassigned ${title}`,
    'task.deleted': `deleted ${title}`,
    'task.started': `started ${title}`,
    'dependency.added': `made ${title} wait for "${meta.depends_on || 'another task'}"`,
    'dependency.removed': `removed a prerequisite from ${title}`,
    'submission.submitted': `submitted version ${meta.version || ''} of ${title}`,
    'submission.approved': `approved version ${meta.version || ''} of ${title}${meta.score != null ? ` with a score of ${meta.score}` : ''}`,
    'submission.revision_requested': `asked for changes to version ${meta.version || ''} of ${title}`,
  };
  return (phrases[entry.action] || entry.action).replace(/\s+/g, ' ').trim();
}

// Which entity an activity row points at, as a link target in the app.
export function activityHref(entry, url) {
  if (entry.entity_type === 'task' && entry.action !== 'task.deleted') return url('app/task.html', { id: entry.entity_id });
  if (entry.entity_type === 'submission') return url('app/review.html', { id: entry.entity_id });
  if (entry.project_id) return url('app/project.html', { id: entry.project_id });
  return null;
}
