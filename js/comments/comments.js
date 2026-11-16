// Task comments. They can be added and read, never edited or deleted.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

const SELECT = 'id, task_id, user_id, content, created_at, author:profiles!comments_user_id_fkey(id, full_name, avatar_url)';

export async function listComments(taskId) {
  return unwrap(
    await supabase.from('comments').select(SELECT).eq('task_id', taskId).order('created_at', { ascending: true }),
  );
}

// The author is filled in by the database from the session, not sent from here.
export async function addComment(taskId, content) {
  return unwrap(await supabase.from('comments').insert({ task_id: taskId, content }).select(SELECT).single());
}
