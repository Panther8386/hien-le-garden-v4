import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const item = await env.DB.prepare(
    `SELECT si.id, si.session_id, si.status, si.name, si.quantity, s.guest_name AS guestName, s.status AS sessionStatus
     FROM gio_xanh_session_items si JOIN gio_xanh_sessions s ON s.id = si.session_id
     WHERE si.id = ?`
  ).bind(params.itemId).first();
  if (!item || String(item.session_id) !== String(params.id)) {
    return jsonError('Không tìm thấy dòng', 404);
  }
  if (item.status === 'voided') return jsonError('Dòng này đã được huỷ trước đó', 400);
  if (item.sessionStatus !== 'open') return jsonError('Chỉ có thể huỷ dòng khi phiên còn đang mở', 400);

  const now = new Date().toISOString();
  const entityLabel = `${item.name} ×${item.quantity} — ${item.guestName}`;

  await env.DB.batch([
    env.DB.prepare(`UPDATE gio_xanh_session_items SET status = 'voided', voided_by = ?, voided_at = ? WHERE id = ?`)
      .bind(auth.username, now, params.itemId),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('service_void', 'gio_xanh_session_item', ?, ?, 'posted', 'voided', ?, ?)`
    ).bind(item.id, entityLabel, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
