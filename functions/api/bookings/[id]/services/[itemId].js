import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const item = await env.DB.prepare(
    `SELECT bsi.id, bsi.booking_id, bsi.status, bsi.name, bsi.quantity, b.guest_name AS guestName
     FROM booking_service_items bsi JOIN bookings b ON b.id = bsi.booking_id
     WHERE bsi.id = ?`
  ).bind(params.itemId).first();
  if (!item || String(item.booking_id) !== String(params.id)) {
    return jsonError('Không tìm thấy dòng dịch vụ', 404);
  }
  if (item.status === 'voided') {
    return jsonError('Dòng dịch vụ này đã được huỷ trước đó', 400);
  }

  const now = new Date().toISOString();
  const entityLabel = `${item.name} ×${item.quantity} — ${item.guestName}`;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE booking_service_items SET status = 'voided', voided_by = ?, voided_at = ? WHERE id = ?`
    ).bind(auth.username, now, params.itemId),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('service_void', 'service_item', ?, ?, 'posted', 'voided', ?, ?)`
    ).bind(item.id, entityLabel, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
