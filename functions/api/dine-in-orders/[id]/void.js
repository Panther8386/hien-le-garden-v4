import { requireAuth } from '../../../../lib/requireAuth.js';
import { canSeeHidden } from '../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'dine_in.manage');
  if (auth instanceof Response) return auth;

  const order = await env.DB.prepare(`SELECT id, table_label AS tableLabel, status, is_hidden FROM dine_in_orders WHERE id = ?`).bind(params.id).first();
  // A hidden order answers exactly like a non-existent id for anyone without records.hide.
  if (!order || !canSeeHidden(auth, order)) return jsonError('Không tìm thấy order', 404);
  if (order.status !== 'open') return jsonError('Chỉ có thể huỷ bàn khi còn đang mở', 400);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM dine_in_order_items WHERE order_id = ? AND status = 'posted'`
  ).bind(params.id).first();

  const now = new Date().toISOString();
  const entityLabel = `${order.tableLabel} — ${totals.n} món, ${totals.total.toLocaleString('vi-VN')}đ`;

  // One D1 batch = one transaction. The audit row is written FIRST and only while the order is
  // still 'open'; the guarded UPDATE follows. If a competing close/void landed after the pre-check,
  // neither statement changes anything (the closed order keeps its income row, no orphan audit).
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       SELECT 'dine_in_order_void', 'dine_in_order', ?, ?, 'open', 'voided', ?, ?
       WHERE EXISTS (SELECT 1 FROM dine_in_orders WHERE id = ? AND status = 'open')`
    ).bind(order.id, entityLabel, auth.username, now, params.id),
    env.DB.prepare(`UPDATE dine_in_orders SET status = 'voided' WHERE id = ? AND status = 'open'`).bind(params.id),
  ]);
  if (results[1].meta.changes === 0) {
    return jsonError('Chỉ có thể huỷ bàn khi còn đang mở', 400);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
