import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const order = await env.DB.prepare(`SELECT id, table_label AS tableLabel, status FROM dine_in_orders WHERE id = ?`).bind(params.id).first();
  if (!order) return jsonError('Không tìm thấy order', 404);
  if (order.status !== 'open') return jsonError('Chỉ có thể chốt khi bàn còn đang mở', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { paymentMethod } = body || {};
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) return jsonError('Vui lòng chọn hình thức thanh toán', 400);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM dine_in_order_items WHERE order_id = ? AND status = 'posted'`
  ).bind(params.id).first();
  if (totals.n === 0) return jsonError('Bàn chưa có món nào, vui lòng huỷ bàn thay vì chốt', 400);

  const now = new Date().toISOString();
  const note = `Order ${order.tableLabel} — ${totals.n} món`;

  const txInsert = await env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
     VALUES ('income', 'khach_vang_lai', ?, ?, ?, 'confirmed', ?, ?)`
  ).bind(totals.total, note, now.slice(0, 10), auth.username, now).run();
  const financeTransactionId = txInsert.meta.last_row_id;

  const orderUpdate = await env.DB.prepare(
    `UPDATE dine_in_orders SET status = 'closed', closed_by = ?, closed_at = ?, payment_method = ?, total_amount = ?, finance_transaction_id = ? WHERE id = ? AND status = 'open'`
  ).bind(auth.username, now, paymentMethod, totals.total, financeTransactionId, params.id).run();

  if (orderUpdate.meta.changes === 0) {
    // Another request already closed/voided this order between our read and this write (TOCTOU).
    // Roll back the finance_transactions row we just inserted so income isn't duplicated.
    await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(financeTransactionId).run();
    return jsonError('Bàn này vừa được chốt hoặc huỷ bởi thao tác khác, vui lòng tải lại', 409);
  }

  return new Response(JSON.stringify({ ok: true, totalAmount: totals.total, financeTransactionId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
