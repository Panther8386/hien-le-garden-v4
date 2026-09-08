// v4/functions/api/asset-inventory-lines/[id]/photo.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function sanitizeFilename(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
}

function photoKeyFor(lineId, filename) {
  return `inventory-line-photos/${lineId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

function canWriteLine(role, batchStatus) {
  if (batchStatus === 'counting') return true;
  if (batchStatus === 'pending_close') return role === 'admin' || role === 'manager';
  return false;
}

async function loadLineWithBatchStatus(env, id) {
  return env.DB.prepare(
    `SELECT l.*, b.status AS batch_status FROM asset_inventory_lines l JOIN asset_inventory_batches b ON b.id = l.batch_id WHERE l.id = ?`
  ).bind(id).first();
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception']);
  if (auth instanceof Response) return auth;

  const existing = await loadLineWithBatchStatus(env, params.id);
  if (!existing) return jsonError('Không tìm thấy dòng kiểm kê', 404);
  if (!canWriteLine(auth.role, existing.batch_status)) return jsonError('Không thể sửa dòng kiểm kê ở trạng thái đợt hiện tại', 400);

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return jsonError('Vui lòng chọn tệp để tải lên', 400);
  if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
    return jsonError('Chỉ chấp nhận ảnh (JPG/PNG/WebP) hoặc PDF', 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return jsonError('Tệp vượt quá dung lượng tối đa 10MB', 400);
  }

  if (existing.photo_key) {
    await env.RECEIPTS.delete(existing.photo_key);
  }

  const key = photoKeyFor(params.id, file.name);
  await env.RECEIPTS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE asset_inventory_lines SET photo_key = ?, photo_filename = ?, photo_uploaded_at = ?, updated_by = ?, updated_at = ? WHERE id = ?`
  ).bind(key, file.name, now, auth.username, now, params.id).run();

  return new Response(JSON.stringify({ ok: true, photoFilename: file.name }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception']);
  if (auth instanceof Response) return auth;

  const existing = await loadLineWithBatchStatus(env, params.id);
  if (!existing) return jsonError('Không tìm thấy dòng kiểm kê', 404);
  if (!canWriteLine(auth.role, existing.batch_status)) return jsonError('Không thể sửa dòng kiểm kê ở trạng thái đợt hiện tại', 400);
  if (!existing.photo_key) return jsonError('Dòng kiểm kê này chưa có ảnh đính kèm', 400);

  await env.RECEIPTS.delete(existing.photo_key);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE asset_inventory_lines SET photo_key = NULL, photo_filename = NULL, photo_uploaded_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?`
  ).bind(auth.username, now, params.id).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM asset_inventory_lines WHERE id = ?`).bind(params.id).first();
  if (!existing || !existing.photo_key) return jsonError('Không tìm thấy ảnh', 404);

  const object = await env.RECEIPTS.get(existing.photo_key);
  if (!object) return jsonError('Không tìm thấy ảnh', 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  const displayName = existing.photo_filename || 'anh-kiem-ke';
  headers.set('Content-Disposition', `inline; filename="${sanitizeFilename(displayName)}"; filename*=UTF-8''${encodeURIComponent(displayName)}`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(object.body, { status: 200, headers });
}
