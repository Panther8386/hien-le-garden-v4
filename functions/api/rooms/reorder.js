import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;
  if (!auth.canManageRoomLayout) {
    return jsonError('Tài khoản không có quyền sắp xếp phòng', 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { order } = body || {};

  if (!Array.isArray(order) || order.length === 0 || !order.every((id) => Number.isInteger(id))) {
    return jsonError('Danh sách thứ tự phòng không hợp lệ', 400);
  }
  if (new Set(order).size !== order.length) {
    return jsonError('Danh sách thứ tự phòng có mã phòng trùng lặp', 400);
  }

  const { results: activeRooms } = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 ORDER BY display_order, id`).all();
  const activeIds = new Set(activeRooms.map((r) => r.id));

  if (order.length !== activeIds.size || !order.every((id) => activeIds.has(id))) {
    return jsonError('Danh sách thứ tự phòng phải khớp đúng tất cả phòng đang hoạt động', 400);
  }

  const oldOrder = activeRooms.map((r) => r.id);
  const statements = order.map((id, index) =>
    env.DB.prepare(`UPDATE rooms SET display_order = ? WHERE id = ?`).bind(index, id)
  );
  statements.push(
    env.DB.prepare(
      `INSERT INTO room_layout_log (changed_by, old_order, new_order, changed_at) VALUES (?, ?, ?, ?)`
    ).bind(auth.username, JSON.stringify(oldOrder), JSON.stringify(order), new Date().toISOString())
  );
  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
