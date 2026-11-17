// Prerequisites: a task can wait for other tasks in the same project to be completed.
// The database refuses loops, cross-project links and links to work already started.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

// What this task waits for: [{ task_id, title, status, assignee_name }]. Readable by
// the assignee too, even when the prerequisite belongs to someone else.
export async function listPrerequisites(taskId) {
  return unwrap(await supabase.rpc('task_prerequisites', { p_task_id: taskId }));
}

// Which tasks wait for this one (managers only; a member's view stays on their own task).
export async function listDependents(taskId) {
  return unwrap(
    await supabase
      .from('task_dependencies')
      .select('task_id, task:tasks!task_dependencies_task_id_fkey(id, title, status)')
      .eq('depends_on_task_id', taskId),
  );
}

export async function addDependency(taskId, dependsOnId) {
  return unwrap(await supabase.rpc('add_task_dependency', { p_task_id: taskId, p_depends_on: dependsOnId }));
}

export async function removeDependency(taskId, dependsOnId) {
  return unwrap(await supabase.rpc('remove_task_dependency', { p_task_id: taskId, p_depends_on: dependsOnId }));
}

export const isBlocking = (prerequisite) => prerequisite.status !== 'completed';
