// v4/functions/api/assets/[id]/photo.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function sanitizeFilename(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
}

function photoKeyFor(assetId, filename) {
  return `asset-photos/${assetId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM assets WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy tài sản', 404);

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
    `UPDATE assets SET photo_key = ?, photo_filename = ?, photo_uploaded_at = ? WHERE id = ?`
  ).bind(key, file.name, now, params.id).run();

  return new Response(JSON.stringify({ ok: true, photoFilename: file.name }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM assets WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy tài sản', 404);
  if (!existing.photo_key) return jsonError('Tài sản này chưa có ảnh đính kèm', 400);

  await env.RECEIPTS.delete(existing.photo_key);

  await env.DB.prepare(
    `UPDATE assets SET photo_key = NULL, photo_filename = NULL, photo_uploaded_at = NULL WHERE id = ?`
  ).bind(params.id).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM assets WHERE id = ?`).bind(params.id).first();
  if (!existing || !existing.photo_key) return jsonError('Không tìm thấy ảnh', 404);

  const object = await env.RECEIPTS.get(existing.photo_key);
  if (!object) return jsonError('Không tìm thấy ảnh', 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  const displayName = existing.photo_filename || 'anh-tai-san';
  headers.set('Content-Disposition', `inline; filename="${sanitizeFilename(displayName)}"; filename*=UTF-8''${encodeURIComponent(displayName)}`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(object.body, { status: 200, headers });
}
