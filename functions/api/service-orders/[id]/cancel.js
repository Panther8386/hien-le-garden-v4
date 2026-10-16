import { hasPermission } from '../../../../lib/permissions.js';
import { readJsonBody } from '../../../../lib/readJsonBody.js';
import {
  json, jsonError, NOT_FOUND, STALE, OPEN_STATUSES, PAYMENT_METHODS, LIMITS, requireOrderPermission, loadVisibleOrder, gateSql, auditInsert,
} from '../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!OPEN_STATUSES.includes(order.status)) return jsonError('Chỉ huỷ được đơn nháp hoặc đã chốt', 400);
  // Keeping or returning a deposit is a money decision.
  if (order.deposit_amount > 0 && !hasPermission(auth, 'service_orders.refund')) return jsonError('Huỷ đơn đã có cọc cần quyền hoàn tiền', 403);
  const parsed = await readJsonBody(request, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const { origin, reason, refundPaymentMethod } = parsed.body;
  if (!['hotel', 'guest'].includes(origin)) return jsonError('Vui lòng chọn bên huỷ', 400);
  if (typeof reason !== 'string' || !reason.trim() || reason.length > LIMITS.reason) return jsonError('Vui lòng nhập lý do huỷ (tối đa 1000 ký tự)', 400);
  const refundAmount = parsed.body.refundAmount ?? (order.deposit_amount > 0 ? undefined : 0);
  if (!Number.isInteger(refundAmount) || refundAmount < 0 || refundAmount > order.deposit_amount) {
    return jsonError(order.deposit_amount > 0 ? 'Số tiền hoàn phải từ 0 đến tổng cọc' : 'Đơn chưa có cọc, không có tiền hoàn', 400);
  }
  if (refundAmount > 0 && !PAYMENT_METHODS.includes(refundPaymentMethod)) return jsonError('Vui lòng chọn hình thức hoàn tiền', 400);
  const method = refundAmount > 0 ? refundPaymentMethod : null;

  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), origin, reason: reason.trim(), refundAmount });
  const gate = gateSql('service_order_cancel');
  const gateBinds = [order.id, auditValue];
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_cancel', order.id, auditValue, auth.username, now,
      `EXISTS (SELECT 1 FROM service_orders WHERE id = ? AND status IN ('draft', 'confirmed') AND deposit_amount = ?)`, [order.id, order.deposit_amount]),
    env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      SELECT 'expense', 'hoan_coc', ?, ?, ?, 'confirmed', ?, ?, ? WHERE ? > 0 AND ${gate}`)
      .bind(refundAmount, `Hoàn cọc đơn #${order.id} — ${order.customer_name}`, now.slice(0, 10), auth.username, now, order.id, refundAmount, ...gateBinds),
    env.DB.prepare(`UPDATE service_orders SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancellation_origin = ?, cancel_reason = ?,
        refund_amount = ?, refund_payment_method = ?, refund_finance_transaction_id = CASE WHEN ? > 0 THEN last_insert_rowid() ELSE NULL END
      WHERE id = ? AND ${gate}`)
      .bind(auth.username, now, origin, reason.trim(), refundAmount, method, refundAmount, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ refundAmount });
}
