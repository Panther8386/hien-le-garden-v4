import {
  json, jsonError, NOT_FOUND, STALE, requireOrderPermission, loadVisibleOrder, readSnapshot, orderGuardSql, gateSql, auditInsert,
} from '../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (order.status !== 'draft') return jsonError('Chỉ chốt được đơn nháp', 400);
  const snapshot = await readSnapshot(env.DB, order.id);
  if (snapshot === '[]') return jsonError('Đơn cần ít nhất 1 dòng trước khi chốt', 400);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID() });
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_confirm', order.id, auditValue, auth.username, now,
      orderGuardSql(['draft']), [order.id, order.deposit_amount, order.primary_category, order.id, snapshot]),
    env.DB.prepare(`UPDATE service_orders SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ? AND ${gateSql('service_order_confirm')}`)
      .bind(auth.username, now, order.id, order.id, auditValue),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ ok: true });
}
