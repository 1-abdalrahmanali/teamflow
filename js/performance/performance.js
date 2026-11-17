// The three personal numbers (Assigned Tasks, Completed Tasks, Average Score) and the
// platform overview. Both are computed by the database, which also decides who may
// see whose numbers.
import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

// Returns { assigned_tasks, completed_tasks, average_score } (average_score is null with no scored work).
export async function memberPerformance(userId, projectId = null) {
  return unwrap(await supabase.rpc('member_performance', { p_user_id: userId, p_project_id: projectId }));
}

export async function overviewStats() {
  return unwrap(await supabase.rpc('overview_stats'));
}

export const formatScore = (value) => (value === null || value === undefined ? 'No score yet' : String(value));
