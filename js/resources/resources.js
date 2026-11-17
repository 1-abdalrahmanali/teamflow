// Learning resources attached to a task: links (YouTube, docs, articles, reference
// projects) and files (PDFs, images, starter code, documents). Managers add and edit
// them; the assignee reads them. The database checks every link and file path again.
import { supabase } from '../config/supabase.js';
import { AppError, unwrap } from '../utils/errors.js';
import { MAX_RESOURCE_BYTES, RESOURCE_TYPES, fileExtension, resourceMime } from '../utils/constants.js';

const COLUMNS =
  'id, task_id, title, description, resource_type, external_url, storage_path, file_name, uploaded_by, created_at, updated_at, uploader:profiles!task_resources_uploaded_by_fkey(id, full_name)';

export async function listResources(taskId) {
  return unwrap(
    await supabase.from('task_resources').select(COLUMNS).eq('task_id', taskId).order('created_at', { ascending: true }),
  );
}

// The 11-character video id from any of the YouTube link shapes the database accepts.
export function youtubeId(link) {
  const match = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(
    String(link || ''),
  );
  return match ? match[1] : null;
}

// Returns an error sentence, or null when the link suits the type.
export function checkLink(type, link) {
  const value = String(link || '').trim();
  if (!value) return 'Paste the link.';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'That is not a complete link. It should start with https://';
  }
  if (parsed.protocol !== 'https:') return 'Use a secure link that starts with https://';
  if (type === 'youtube' && !youtubeId(value)) return 'Use a YouTube video link, such as https://www.youtube.com/watch?v=...';
  return null;
}

// Returns an error sentence, or null when the file suits the type.
export function checkFile(type, file) {
  if (!file) return 'Choose a file.';
  const spec = RESOURCE_TYPES[type];
  const ext = fileExtension(file.name);
  if (!spec?.exts?.includes(ext)) return `A ${spec?.label.toLowerCase() || 'file'} must be one of: ${spec?.exts?.join(', ')}.`;
  if (!resourceMime(ext)) return 'That kind of file cannot be uploaded.';
  if (file.size > MAX_RESOURCE_BYTES) return 'That file is over 20 MB. Choose a smaller one or share it as a link.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

const safeFileName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(-120) || 'file';

// values: { task, type, title, description, link?, file? }
export async function addResource({ task, type, title, description = '', link = null, file = null }) {
  const spec = RESOURCE_TYPES[type];
  if (!spec) throw new AppError('Choose what kind of resource this is.');
  if (!title.trim()) throw new AppError('Give the resource a title.');
  const row = { task_id: task.id, resource_type: type, title: title.trim(), description: description.trim() };
  if (spec.kind === 'link') {
    const problem = checkLink(type, link);
    if (problem) throw new AppError(problem);
    row.external_url = link.trim();
  } else {
    const problem = checkFile(type, file);
    if (problem) throw new AppError(problem);
    const path = `${task.project_id}/${task.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    unwrap(
      await supabase.storage.from('task-resources').upload(path, file, { contentType: resourceMime(fileExtension(file.name)) }),
    );
    row.storage_path = path;
    row.file_name = file.name.slice(0, 255);
    try {
      return unwrap(await supabase.from('task_resources').insert(row).select(COLUMNS).single());
    } catch (error) {
      // The row was refused, so the uploaded file would be left without a resource.
      await supabase.storage.from('task-resources').remove([path]).catch(() => {});
      throw error;
    }
  }
  return unwrap(await supabase.from('task_resources').insert(row).select(COLUMNS).single());
}

// Title, description and (for link types) the link can change; the type and file cannot.
export async function updateResource(resource, { title, description, link }) {
  const patch = { title: title.trim(), description: (description || '').trim() };
  if (RESOURCE_TYPES[resource.resource_type]?.kind === 'link') {
    const problem = checkLink(resource.resource_type, link);
    if (problem) throw new AppError(problem);
    patch.external_url = link.trim();
  }
  if (!patch.title) throw new AppError('Give the resource a title.');
  return unwrap(await supabase.from('task_resources').update(patch).eq('id', resource.id).select(COLUMNS).single());
}

export async function deleteResource(resource) {
  unwrap(await supabase.from('task_resources').delete().eq('id', resource.id));
  if (resource.storage_path) {
    await supabase.storage.from('task-resources').remove([resource.storage_path]).catch(() => {});
  }
}

// A short-lived link to a resource file. download=true makes the browser save it.
export async function resourceFileUrl(resource, { download = false } = {}) {
  const data = unwrap(
    await supabase.storage
      .from('task-resources')
      .createSignedUrl(resource.storage_path, 600, download ? { download: resource.file_name || true } : undefined),
  );
  return data.signedUrl;
}
