import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_LOCATION_TYPES = ['room', 'warehouse', 'common_area'];

function coerceRow(r) {
  return {
    id: r.id,
    locationType: r.location_type,
    roomId: r.room_id,
    code: r.code,
    name: r.name,
    isActive: !!r.is_active,
    displayOrder: r.display_order,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const includeInactive = url.searchParams.get('includeInactive') === '1';
  const type = url.searchParams.get('type');
  if (type && !VALID_LOCATION_TYPES.includes(type)) return jsonError('Loại vị trí không hợp lệ', 400);

  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push('is_active = 1');
  if (type) { clauses.push('location_type = ?'); params.push(type); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT * FROM asset_locations ${where} ORDER BY location_type, display_order, id`
  ).bind(...params).all();

  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { locationType, roomId, code, name, note } = body || {};

  if (!VALID_LOCATION_TYPES.includes(locationType)) return jsonError('Loại vị trí không hợp lệ', 400);
  if (typeof name !== 'string' || name.trim() === '') return jsonError('Vui lòng nhập tên vị trí', 400);

  if (locationType === 'room') {
    if (!Number.isInteger(roomId)) return jsonError('Vui lòng chọn phòng', 400);
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(roomId).first();
    if (!room) return jsonError('Không tìm thấy phòng', 400);
    const existing = await env.DB.prepare(`SELECT id FROM asset_locations WHERE room_id = ?`).bind(roomId).first();
    if (existing) return jsonError('Phòng này đã có vị trí tài sản tương ứng', 400);
  } else if (roomId !== undefined && roomId !== null) {
    return jsonError('Vị trí không phải phòng thì không được gán roomId', 400);
  }

  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO asset_locations (location_type, room_id, code, name, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(locationType, locationType === 'room' ? roomId : null, code || null, name.trim(), note || null, auth.username, now).run();
  const newId = insert.meta.last_row_id;

  await env.DB.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
     VALUES ('asset_location_create', 'asset_location', ?, ?, NULL, ?, ?, ?)`
  ).bind(newId, name.trim(), name.trim(), auth.username, now).run();

  return new Response(JSON.stringify({ id: newId, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
