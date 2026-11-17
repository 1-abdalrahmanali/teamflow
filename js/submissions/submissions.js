// Submission data. Every submission is a new version; nothing here can change an old one.
import { supabase } from '../config/supabase.js';
import { AppError, unwrap } from '../utils/errors.js';
import { MAX_SUBMISSION_BYTES, SUBMISSION_FILE_TYPES, fileExtension } from '../utils/constants.js';

const LIST_COLUMNS = 'id, task_id, user_id, version, submission_type, language, file_name, review_status, submitted_at';
const CONTENT = 'code_content, text_content, storage_path';
const AUTHOR = 'author:profiles!submissions_user_id_fkey(id, full_name, avatar_url)';
const REVIEW =
  'review:submission_reviews(id, review_action, feedback, score, created_at, reviewer:profiles!submission_reviews_reviewer_id_fkey(id, full_name, avatar_url))';
const TASK =
  'task:tasks(id, title, project_id, submission_type, status, programming_language, assigned_to, deadline, project:projects(id, name, status, timezone))';

// Lists leave out the content itself; it is loaded only when one version is opened.
export async function listSubmissions({ taskIds, taskId, reviewStatus, userId, excludeUserId, limit } = {}) {
  if (Array.isArray(taskIds) && taskIds.length === 0) return [];
  let query = supabase
    .from('submissions')
    .select(`${LIST_COLUMNS}, ${AUTHOR}, ${REVIEW}, ${TASK}`)
    .order('submitted_at', { ascending: false });
  if (taskIds) query = query.in('task_id', taskIds);
  if (taskId) query = query.eq('task_id', taskId);
  if (reviewStatus) query = query.eq('review_status', reviewStatus);
  if (userId) query = query.eq('user_id', userId);
  if (excludeUserId) query = query.neq('user_id', excludeUserId);
  if (limit) query = query.limit(limit);
  return unwrap(await query);
}

export async function getSubmission(id) {
  return unwrap(
    await supabase
      .from('submissions')
      .select(`${LIST_COLUMNS}, ${CONTENT}, ${AUTHOR}, ${REVIEW}, ${TASK}`)
      .eq('id', id)
      .maybeSingle(),
  );
}

// Every version of one task, oldest first, with content and its review.
export async function listVersions(taskId) {
  return unwrap(
    await supabase
      .from('submissions')
      .select(`${LIST_COLUMNS}, ${CONTENT}, ${AUTHOR}, ${REVIEW}`)
      .eq('task_id', taskId)
      .order('version', { ascending: true }),
  );
}

const safeFileName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(-120) || 'file';

// For file tasks the file is uploaded first, into <task id>/<user id>/, and the
// database then checks that the path really belongs to this person and task.
// Returns { id, version }.
export async function submitSolution({ task, userId, code = null, language = null, text = null, file = null }) {
  let filePath = null;
  let fileName = null;
  if (task.submission_type === 'file') {
    if (!file) throw new AppError('Choose a file to upload.');
    if (file.size > MAX_SUBMISSION_BYTES) throw new AppError('That file is over 10 MB. Choose a smaller one.');
    if (file.size === 0) throw new AppError('That file is empty. Choose the file with your work in it.');
    filePath = `${task.id}/${userId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    fileName = file.name.slice(0, 200);
    const contentType = SUBMISSION_FILE_TYPES[fileExtension(file.name)] || 'application/octet-stream';
    unwrap(await supabase.storage.from('submissions').upload(filePath, file, { contentType }));
  }
  return unwrap(
    await supabase.rpc('submit_solution', {
      p_task_id: task.id,
      p_code: task.submission_type === 'code' ? code : null,
      p_language: task.submission_type === 'code' ? language : null,
      p_text: task.submission_type === 'text' ? text : null,
      p_file_path: filePath,
      p_file_name: fileName,
    }),
  );
}

// A link that works for five minutes and downloads the file rather than opening it.
export async function getFileUrl(storagePath, fileName) {
  const data = unwrap(
    await supabase.storage.from('submissions').createSignedUrl(storagePath, 300, { download: fileName || true }),
  );
  return data.signedUrl;
}
