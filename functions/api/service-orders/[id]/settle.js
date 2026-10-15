import { readJsonBody } from '../../../../lib/readJsonBody.js';
import {
  json, jsonError, NOT_FOUND, STALE, PAYMENT_METHODS, requireOrderPermission, loadVisibleOrder, loadItems, settlementPlan,
  readSnapshot, orderGuardSql, gateSql, auditInsert,
} from '../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (order.status !== 'confirmed') return jsonError('Chỉ tất toán được đơn đã chốt', 400);
  const parsed = await readJsonBody(request, { maxBytes: 1024 });
  if (!parsed.ok) return parsed.response;
  const items = await loadItems(env.DB, order.id);
  const plan = settlementPlan(items, order.primary_category, order.deposit_amount);
  const paymentMethod = plan.length ? parsed.body.paymentMethod : null;
  if (plan.length && !PAYMENT_METHODS.includes(paymentMethod)) return jsonError('Vui lòng chọn hình thức thanh toán', 400);

  const snapshot = await readSnapshot(env.DB, order.id);
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), paymentMethod, receipts: plan });
  const gate = gateSql('service_order_settle');
  const gateBinds = [order.id, auditValue];
  const note = `Tất toán đơn #${order.id} — ${order.customer_name}`;
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_settle', order.id, auditValue, auth.username, now,
      orderGuardSql(['confirmed']), [order.id, order.deposit_amount, order.primary_category, order.id, snapshot]),
    ...plan.map((p) => env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      SELECT 'income', ?, ?, ?, ?, 'confirmed', ?, ?, ? WHERE ${gate}`)
      .bind(p.category, p.amount, note, now.slice(0, 10), auth.username, now, order.id, ...gateBinds)),
    env.DB.prepare(`UPDATE service_orders SET status = 'settled', settled_by = ?, settled_at = ?, settlement_payment_method = ? WHERE id = ? AND ${gate}`)
      .bind(auth.username, now, paymentMethod, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ receipts: plan });
}
