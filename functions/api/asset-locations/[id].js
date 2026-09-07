import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM asset_locations WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy vị trí', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};
  if ('locationType' in body) return jsonError('Không thể đổi loại vị trí sau khi tạo', 400);
  if ('roomId' in body) return jsonError('Không thể đổi phòng gắn với vị trí sau khi tạo', 400);

  const code = 'code' in body ? body.code : existing.code;
  const name = 'name' in body ? body.name : existing.name;
  const note = 'note' in body ? body.note : existing.note;
  const isActive = 'isActive' in body ? body.isActive : !!existing.is_active;

  if (typeof name !== 'string' || name.trim() === '') return jsonError('Vui lòng nhập tên vị trí', 400);
  if (typeof isActive !== 'boolean') return jsonError('Trạng thái không hợp lệ', 400);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE asset_locations SET code = ?, name = ?, note = ?, is_active = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(code || null, name.trim(), note || null, isActive ? 1 : 0, auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('asset_location_update', 'asset_location', ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, name.trim(), existing.name, name.trim(), auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
