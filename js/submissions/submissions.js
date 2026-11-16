// Submission data. Every submission is a new row; nothing here can change an old version.
import { supabase } from '../config/supabase.js';
import { AppError, unwrap } from '../utils/errors.js';
import { MAX_UPLOAD_BYTES } from '../utils/constants.js';

const LIST_COLUMNS =
  'id, task_id, user_id, language, file_name, version, review_status, feedback, submitted_at, reviewed_at';
const PEOPLE =
  'author:profiles!submissions_user_id_fkey(id, full_name, avatar_url), reviewer:profiles!submissions_reviewed_by_fkey(id, full_name, avatar_url)';
const TASK =
  'task:tasks(id, title, project_id, submission_type, status, programming_language, project:projects(id, name, owner_id))';

// Lists leave out the content itself; it is loaded only when one submission is opened.
// taskIds narrows the list to some tasks (for example, the tasks of one project).
export async function listSubmissions({ taskIds, taskId, reviewStatus, userId, excludeUserId, limit } = {}) {
  if (Array.isArray(taskIds) && taskIds.length === 0) return [];
  let query = supabase
    .from('submissions')
    .select(`${LIST_COLUMNS}, ${PEOPLE}, ${TASK}`)
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
      .select(`${LIST_COLUMNS}, code, file_path, reviewed_by, ${PEOPLE}, ${TASK}`)
      .eq('id', id)
      .maybeSingle(),
  );
}

// All versions of one task, oldest first, with their content.
export async function listVersions(taskId) {
  return unwrap(
    await supabase
      .from('submissions')
      .select(`${LIST_COLUMNS}, code, file_path, ${PEOPLE}`)
      .eq('task_id', taskId)
      .order('version', { ascending: true }),
  );
}

// For file tasks the file is uploaded first, into <task id>/<user id>/, and the
// database then checks that the path really belongs to this person and task.
export async function submitSolution({ task, userId, content = null, language = null, file = null }) {
  let filePath = null;
  let fileName = null;
  if (task.submission_type === 'file_upload') {
    if (!file) throw new AppError('Choose a file to upload.');
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError('That file is over 10 MB. Choose a smaller one.');
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'file';
    filePath = `${task.id}/${userId}/${crypto.randomUUID()}-${safeName}`;
    fileName = file.name;
    unwrap(
      await supabase.storage
        .from('submissions')
        .upload(filePath, file, { contentType: file.type || 'application/octet-stream' }),
    );
  }
  return unwrap(
    await supabase.rpc('submit_solution', {
      p_task_id: task.id,
      p_content: content,
      p_language: language,
      p_file_path: filePath,
      p_file_name: fileName,
    }),
  );
}

// decision: 'approve' or 'request_revision'. Feedback is required for a revision.
export async function reviewSubmission(submissionId, decision, feedback) {
  return unwrap(
    await supabase.rpc('review_submission', {
      p_submission_id: submissionId,
      p_decision: decision,
      p_feedback: feedback || null,
    }),
  );
}

// A link that works for five minutes, for downloading an uploaded file.
export async function getFileUrl(filePath) {
  const data = unwrap(await supabase.storage.from('submissions').createSignedUrl(filePath, 300));
  return data.signedUrl;
}
