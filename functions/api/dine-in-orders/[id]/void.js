import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const order = await env.DB.prepare(`SELECT id, table_label AS tableLabel, status FROM dine_in_orders WHERE id = ?`).bind(params.id).first();
  if (!order) return jsonError('Không tìm thấy order', 404);
  if (order.status !== 'open') return jsonError('Chỉ có thể huỷ bàn khi còn đang mở', 400);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM dine_in_order_items WHERE order_id = ? AND status = 'posted'`
  ).bind(params.id).first();

  const now = new Date().toISOString();
  const entityLabel = `${order.tableLabel} — ${totals.n} món, ${totals.total.toLocaleString('vi-VN')}đ`;

  await env.DB.batch([
    env.DB.prepare(`UPDATE dine_in_orders SET status = 'voided' WHERE id = ?`).bind(params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('dine_in_order_void', 'dine_in_order', ?, ?, 'open', 'voided', ?, ?)`
    ).bind(order.id, entityLabel, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
