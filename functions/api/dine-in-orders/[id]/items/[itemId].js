import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const item = await env.DB.prepare(
    `SELECT oi.id, oi.order_id, oi.status, oi.name, oi.quantity, o.table_label AS tableLabel, o.status AS orderStatus
     FROM dine_in_order_items oi JOIN dine_in_orders o ON o.id = oi.order_id
     WHERE oi.id = ?`
  ).bind(params.itemId).first();
  if (!item || String(item.order_id) !== String(params.id)) {
    return jsonError('Không tìm thấy dòng món', 404);
  }
  if (item.status === 'voided') return jsonError('Dòng này đã được huỷ trước đó', 400);
  if (item.orderStatus !== 'open') return jsonError('Chỉ có thể huỷ dòng khi bàn còn đang mở', 400);

  const now = new Date().toISOString();
  const entityLabel = `${item.name} ×${item.quantity} — ${item.tableLabel}`;

  await env.DB.batch([
    env.DB.prepare(`UPDATE dine_in_order_items SET status = 'voided', voided_by = ?, voided_at = ? WHERE id = ?`)
      .bind(auth.username, now, params.itemId),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('service_void', 'dine_in_order_item', ?, ?, 'posted', 'voided', ?, ?)`
    ).bind(item.id, entityLabel, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
