import {
  json, jsonError, NOT_FOUND, STALE, requireOrderPermission, loadVisibleOrder, gateSql, auditInsert,
} from '../../../../../lib/serviceOrders.js';

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.refund');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!['draft', 'confirmed'].includes(order.status)) return jsonError('Chỉ xoá cọc của đơn nháp hoặc đã chốt', 400);
  const deposit = await env.DB.prepare('SELECT * FROM service_order_deposits WHERE id = ? AND order_id = ?').bind(params.depositId, order.id).first();
  if (!deposit) return jsonError('Không tìm thấy dòng cọc', 404);
  if (deposit.voided_at) return jsonError('Dòng cọc này đã được xoá', 400);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), depositId: deposit.id, amount: deposit.amount });
  const gate = gateSql('service_order_deposit_delete');
  const gateBinds = [order.id, auditValue];
  const guard = `EXISTS (SELECT 1 FROM service_orders WHERE id = ? AND status IN ('draft', 'confirmed') AND deposit_amount = ?)
    AND EXISTS (SELECT 1 FROM service_order_deposits WHERE id = ? AND order_id = ? AND voided_at IS NULL)`;
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_deposit_delete', order.id, auditValue, auth.username, now, guard,
      [order.id, order.deposit_amount, deposit.id, order.id]),
    env.DB.prepare(`UPDATE service_order_deposits SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL AND ${gate}`)
      .bind(auth.username, now, deposit.id, ...gateBinds),
    env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL AND ${gate}`)
      .bind(auth.username, now, deposit.finance_transaction_id, ...gateBinds),
    env.DB.prepare(`UPDATE service_orders SET deposit_amount = deposit_amount - ? WHERE id = ? AND ${gate}`).bind(deposit.amount, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ ok: true });
}
