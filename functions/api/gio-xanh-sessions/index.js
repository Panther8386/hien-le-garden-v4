import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_STATUSES = ['open', 'closed', 'voided'];

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open';
  if (!VALID_STATUSES.includes(status)) return jsonError('Trạng thái không hợp lệ', 400);
  const includeHidden = url.searchParams.get('includeHidden') === '1' && auth.role === 'admin';

  const { results } = await env.DB.prepare(
    `SELECT s.id, s.room_id AS roomId, r.name AS roomName, s.guest_name AS guestName, s.phone, s.status,
       s.opened_by AS openedBy, s.opened_at AS openedAt, s.is_hidden AS isHidden,
       COALESCE((SELECT SUM(amount) FROM gio_xanh_session_items WHERE session_id = s.id AND status = 'posted'), 0) AS currentTotal
     FROM gio_xanh_sessions s JOIN rooms r ON r.id = s.room_id
     WHERE s.status = ?${includeHidden ? '' : ' AND s.is_hidden = 0'} ORDER BY s.opened_at ASC`
  ).bind(status).all();

  return new Response(JSON.stringify(results.map((r) => ({ ...r, isHidden: !!r.isHidden }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { roomId, guestName, phone } = body || {};

  if (!Number.isInteger(roomId)) return jsonError('Vui lòng chọn phòng', 400);
  if (typeof guestName !== 'string' || guestName.trim() === '') return jsonError('Vui lòng nhập tên khách', 400);
  if (guestName.trim().length > 200) return jsonError('Tên khách quá dài', 400);
  if (phone !== undefined && phone !== null && typeof phone !== 'string') return jsonError('Số điện thoại không hợp lệ', 400);
  if (typeof phone === 'string' && phone.trim().length > 20) return jsonError('Số điện thoại quá dài', 400);

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ? AND is_active = 1`).bind(roomId).first();
  if (!room) return jsonError('Phòng không tồn tại hoặc đã ngừng hoạt động', 400);

  const existing = await env.DB.prepare(`SELECT id FROM gio_xanh_sessions WHERE room_id = ? AND status = 'open'`).bind(roomId).first();
  if (existing) return jsonError('Phòng này đang có phiên Giờ Xanh khác chưa chốt', 400);

  const now = new Date().toISOString();
  let insert;
  try {
    insert = await env.DB.prepare(
      `INSERT INTO gio_xanh_sessions (room_id, guest_name, phone, status, opened_by, opened_at) VALUES (?, ?, ?, 'open', ?, ?)`
    ).bind(roomId, guestName.trim(), phone ? (phone.trim() || null) : null, auth.username, now).run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return jsonError('Phòng này đang có phiên Giờ Xanh khác chưa chốt', 400);
    }
    throw err;
  }

  return new Response(JSON.stringify({ id: insert.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
