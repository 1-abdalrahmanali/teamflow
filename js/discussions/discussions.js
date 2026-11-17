// A task's discussion: questions and comments, one level of replies, pinning by managers.
import { supabase } from '../config/supabase.js';
import { AppError, unwrap } from '../utils/errors.js';

const COLUMNS =
  'id, task_id, user_id, parent_comment_id, kind, content, is_pinned, created_at, updated_at, author:profiles!task_comments_user_id_fkey(id, full_name, avatar_url)';

// Returns top-level posts (pinned first, then oldest first), each with its replies.
export async function listThreads(taskId) {
  const rows = unwrap(
    await supabase.from('task_comments').select(COLUMNS).eq('task_id', taskId).order('created_at', { ascending: true }),
  );
  const byParent = new Map();
  for (const row of rows) {
    if (row.parent_comment_id) {
      if (!byParent.has(row.parent_comment_id)) byParent.set(row.parent_comment_id, []);
      byParent.get(row.parent_comment_id).push(row);
    }
  }
  return rows
    .filter((row) => !row.parent_comment_id)
    .map((row) => ({ ...row, replies: byParent.get(row.id) || [] }))
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned));
}

const clean = (text) => {
  const value = String(text || '').trim();
  if (!value) throw new AppError('Write something first.');
  if (value.length > 4000) throw new AppError('Keep it under 4,000 characters.');
  return value;
};

// kind: 'question' or 'comment'.
export async function postThread(taskId, kind, content) {
  return unwrap(
    await supabase.from('task_comments').insert({ task_id: taskId, kind, content: clean(content) }).select(COLUMNS).single(),
  );
}

export async function postReply(taskId, parentId, content) {
  return unwrap(
    await supabase
      .from('task_comments')
      .insert({ task_id: taskId, parent_comment_id: parentId, content: clean(content) })
      .select(COLUMNS)
      .single(),
  );
}

export async function editPost(id, content) {
  return unwrap(await supabase.from('task_comments').update({ content: clean(content) }).eq('id', id).select(COLUMNS).single());
}

export async function deletePost(id) {
  return unwrap(await supabase.from('task_comments').delete().eq('id', id));
}

export async function setPinned(id, pinned) {
  return unwrap(await supabase.rpc('set_comment_pinned', { p_comment_id: id, p_pinned: pinned }));
}
