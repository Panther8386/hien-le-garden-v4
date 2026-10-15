import { readJsonBody } from '../../../../../lib/readJsonBody.js';
import {
  json, jsonError, NOT_FOUND, STALE, DEPOSIT_EXCEEDS, OPEN_STATUSES, PAYMENT_METHODS, LIMITS, requireOrderPermission, loadVisibleOrder,
  loadItems, categoryTotals, readSnapshot, orderGuardSql, gateSql, auditInsert,
} from '../../../../../lib/serviceOrders.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!OPEN_STATUSES.includes(order.status)) return jsonError('Chỉ nhận cọc cho đơn nháp hoặc đã chốt', 400);
  const parsed = await readJsonBody(request, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const { amount, paymentMethod, note } = parsed.body;
  if (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.total) return jsonError('Số tiền cọc phải là số nguyên dương', 400);
  if (!PAYMENT_METHODS.includes(paymentMethod)) return jsonError('Vui lòng chọn hình thức thanh toán', 400);
  if (note != null && (typeof note !== 'string' || note.length > 500)) return jsonError('Ghi chú tối đa 500 ký tự', 400);
  const snapshot = await readSnapshot(env.DB, order.id); // snapshot first: a later change fails the guard
  const items = await loadItems(env.DB, order.id);
  if (order.deposit_amount + amount > (categoryTotals(items)[order.primary_category] || 0)) return jsonError(DEPOSIT_EXCEEDS, 400);

  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), amount, paymentMethod });
  const gate = gateSql('service_order_deposit');
  const gateBinds = [order.id, auditValue];
  const cleanNote = note && note.trim() ? note.trim() : null;
  const txNote = `Cọc đơn #${order.id} — ${order.customer_name}${cleanNote ? ` — ${cleanNote}` : ''}`;
  const results = await env.DB.batch([
    auditInsert(env.DB, 'service_order_deposit', order.id, auditValue, auth.username, now,
      orderGuardSql(OPEN_STATUSES), [order.id, order.deposit_amount, order.primary_category, order.id, snapshot]),
    env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
      SELECT 'income', ?, ?, ?, ?, 'confirmed', ?, ?, ? WHERE ${gate}`)
      .bind(order.primary_category, amount, txNote, now.slice(0, 10), auth.username, now, order.id, ...gateBinds),
    // Immediately follows the receipt INSERT in the same transaction.
    env.DB.prepare(`INSERT INTO service_order_deposits (order_id, amount, payment_method, note, finance_transaction_id, created_by, created_at)
      SELECT ?, ?, ?, ?, last_insert_rowid(), ?, ? WHERE ${gate}`)
      .bind(order.id, amount, paymentMethod, cleanNote, auth.username, now, ...gateBinds),
    env.DB.prepare(`UPDATE service_orders SET deposit_amount = deposit_amount + ? WHERE id = ? AND ${gate}`).bind(amount, order.id, ...gateBinds),
  ]);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ depositId: results[2].meta.last_row_id, depositAmount: order.deposit_amount + amount }, 201);
}
