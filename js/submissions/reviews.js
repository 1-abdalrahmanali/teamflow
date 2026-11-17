// Reviews and private reviewer notes. The database decides who may review (a manager
// of the project who did not write the work) and who may read the notes (the same
// people, never the member).
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

// decision: 'approve' (score 0 to 100 required) or 'request_revision' (feedback required).
export async function reviewSubmission({ submissionId, decision, feedback = '', score = null, internalNote = '' }) {
  return unwrap(
    await supabase.rpc('review_submission', {
      p_submission_id: submissionId,
      p_decision: decision,
      p_feedback: feedback || null,
      p_score: decision === 'approve' ? score : null,
      p_internal_note: internalNote || null,
    }),
  );
}

export async function addInternalNote(submissionId, content) {
  return unwrap(await supabase.rpc('add_internal_note', { p_submission_id: submissionId, p_content: content }));
}

// Notes for every version of a task the reviewer can see, oldest first.
export async function listInternalNotes(submissionIds) {
  if (!submissionIds.length) return [];
  return unwrap(
    await supabase
      .from('submission_internal_notes')
      .select('id, submission_id, content, created_at, reviewer:profiles!submission_internal_notes_reviewer_id_fkey(id, full_name, avatar_url)')
      .in('submission_id', submissionIds)
      .order('created_at', { ascending: true }),
  );
}
