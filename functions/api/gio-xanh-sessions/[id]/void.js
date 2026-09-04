import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const session = await env.DB.prepare(
    `SELECT s.id, s.guest_name AS guestName, s.status, r.name AS roomName
     FROM gio_xanh_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.id = ?`
  ).bind(params.id).first();
  if (!session) return jsonError('Không tìm thấy phiên', 404);
  if (session.status !== 'open') return jsonError('Chỉ có thể huỷ phiên khi còn đang mở', 400);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM gio_xanh_session_items WHERE session_id = ? AND status = 'posted'`
  ).bind(params.id).first();

  const now = new Date().toISOString();
  const entityLabel = `${session.guestName} — ${session.roomName} — ${totals.n} dòng, ${totals.total.toLocaleString('vi-VN')}đ`;

  const sessionUpdate = await env.DB.prepare(
    `UPDATE gio_xanh_sessions SET status = 'voided' WHERE id = ? AND status = 'open'`
  ).bind(params.id).run();

  if (sessionUpdate.meta.changes === 0) {
    // Thao tác khác vừa đóng/huỷ phiên này giữa lúc đọc và ghi (race condition).
    return jsonError('Phiên này vừa được chốt hoặc huỷ bởi thao tác khác, vui lòng tải lại', 409);
  }

  await env.DB.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
     VALUES ('gio_xanh_session_void', 'gio_xanh_session', ?, ?, 'open', 'voided', ?, ?)`
  ).bind(session.id, entityLabel, auth.username, now).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
