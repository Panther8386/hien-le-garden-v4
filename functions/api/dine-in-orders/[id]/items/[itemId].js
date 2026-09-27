import { requireAuth } from '../../../../../lib/requireAuth.js';
import { canSeeHidden } from '../../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, 'dine_in.manage');
  if (auth instanceof Response) return auth;

  const item = await env.DB.prepare(
    `SELECT oi.id, oi.order_id, oi.status, oi.name, oi.quantity, o.table_label AS tableLabel, o.status AS orderStatus, o.is_hidden
     FROM dine_in_order_items oi JOIN dine_in_orders o ON o.id = oi.order_id
     WHERE oi.id = ?`
  ).bind(params.itemId).first();
  if (!item || String(item.order_id) !== String(params.id)) {
    return jsonError('Không tìm thấy dòng món', 404);
  }
  // A hidden parent order answers exactly like a non-existent id for anyone without records.hide.
  if (!canSeeHidden(auth, item)) {
    return jsonError('Không tìm thấy dòng món', 404);
  }
  if (item.status === 'voided') return jsonError('Dòng này đã được huỷ trước đó', 400);
  if (item.orderStatus !== 'open') return jsonError('Chỉ có thể huỷ dòng khi bàn còn đang mở', 400);

  const now = new Date().toISOString();
  const entityLabel = `${item.name} ×${item.quantity} — ${item.tableLabel}`;

  // One D1 batch = one transaction. Both statements require the item to still be 'posted' AND its
  // order to still be 'open'; the audit row is written FIRST, the guarded UPDATE LAST. If a
  // concurrent close/void of the order, or a concurrent void of this item, landed after the
  // pre-check, neither statement changes anything.
  const stillVoidable = `EXISTS (SELECT 1 FROM dine_in_order_items oi JOIN dine_in_orders o ON o.id = oi.order_id
                                 WHERE oi.id = ? AND oi.status = 'posted' AND o.status = 'open')`;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       SELECT 'service_void', 'dine_in_order_item', ?, ?, 'posted', 'voided', ?, ?
       WHERE ${stillVoidable}`
    ).bind(item.id, entityLabel, auth.username, now, params.itemId),
    env.DB.prepare(`UPDATE dine_in_order_items SET status = 'voided', voided_by = ?, voided_at = ? WHERE id = ? AND ${stillVoidable}`)
      .bind(auth.username, now, params.itemId, params.itemId),
  ]);
  if (results[1].meta.changes === 0) {
    // Lost a race: answer with the same message the pre-check would give for the current state.
    const current = await env.DB.prepare(
      `SELECT oi.status, o.status AS orderStatus FROM dine_in_order_items oi JOIN dine_in_orders o ON o.id = oi.order_id WHERE oi.id = ?`
    ).bind(params.itemId).first();
    if (current && current.status === 'voided') return jsonError('Dòng này đã được huỷ trước đó', 400);
    return jsonError('Chỉ có thể huỷ dòng khi bàn còn đang mở', 400);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
