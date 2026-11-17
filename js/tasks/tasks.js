// Task data. Status is never written from here: only start_task, submit_solution
// and review_submission (database functions) move it.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

const COLUMNS =
  'id, project_id, title, description, requirements, assigned_to, status, priority, deadline, programming_language, submission_type, created_by, created_at, updated_at';
const SELECT = `${COLUMNS}, project:projects(id, name, status, timezone), assignee:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url, email)`;

export async function listTasks({ projectId, assignedTo, status, statuses } = {}) {
  let query = supabase
    .from('tasks')
    .select(SELECT)
    .order('deadline', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (status) query = query.eq('status', status);
  if (statuses) query = query.in('status', statuses);
  return unwrap(await query);
}

export async function getTask(id) {
  return unwrap(await supabase.from('tasks').select(SELECT).eq('id', id).maybeSingle());
}

// values: project_id, title, description, requirements, assigned_to, priority,
// deadline, programming_language, submission_type.
export async function createTask(values) {
  return unwrap(await supabase.from('tasks').insert(values).select(COLUMNS).single());
}

export async function updateTask(id, values) {
  return unwrap(await supabase.from('tasks').update(values).eq('id', id).select(COLUMNS).single());
}

export async function deleteTask(id) {
  return unwrap(await supabase.from('tasks').delete().eq('id', id));
}

export async function startTask(id) {
  return unwrap(await supabase.rpc('start_task', { p_task_id: id }));
}

// The ids, among those given, of tasks still waiting on an unfinished prerequisite.
export async function blockedTaskIds(taskIds) {
  if (!taskIds.length) return new Set();
  const rows = unwrap(await supabase.rpc('blocked_tasks', { p_task_ids: taskIds }));
  return new Set((rows || []).map((row) => (typeof row === 'string' ? row : row.blocked_tasks)));
}

export const isOpen = (task) => task.status !== 'completed';
