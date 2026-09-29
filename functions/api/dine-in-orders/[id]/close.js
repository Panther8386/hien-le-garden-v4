import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { canSeeHidden } from '../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'dine_in.manage');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without dine_in.view answer like a missing id.
  if (!hasPermission(auth, 'dine_in.view')) return jsonError('Không tìm thấy order', 404);

  const order = await env.DB.prepare(`SELECT id, table_label AS tableLabel, status, is_hidden FROM dine_in_orders WHERE id = ?`).bind(params.id).first();
  // A hidden order answers exactly like a non-existent id for anyone without records.hide.
  if (!order || !canSeeHidden(auth, order)) return jsonError('Không tìm thấy order', 404);
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

  let orderUpdate;
  try {
    orderUpdate = await env.DB.prepare(
      // The total predicate rejects a stale total: if an item was added/voided after the SUM above,
      // changes = 0 and the income row is removed below (same path as a lost close/void race).
      `UPDATE dine_in_orders SET status = 'closed', closed_by = ?, closed_at = ?, payment_method = ?, total_amount = ?, finance_transaction_id = ?
       WHERE id = ? AND status = 'open'
         AND (SELECT COALESCE(SUM(amount), 0) FROM dine_in_order_items WHERE order_id = ? AND status = 'posted') = ?`
    ).bind(auth.username, now, paymentMethod, totals.total, financeTransactionId, params.id, params.id, totals.total).run();
  } catch (err) {
    // Unexpected DB error after the income row was created: remove it so no orphan income remains.
    try {
      await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(financeTransactionId).run();
    } catch (cleanupErr) {
      // Ignore cleanup errors — do not mask the original failure.
    }
    return jsonError('Có lỗi khi chốt bàn, vui lòng thử lại', 500);
  }

  if (orderUpdate.meta.changes === 0) {
    // Another request already closed/voided this order between our read and this write (TOCTOU).
    // Roll back the finance_transactions row we just inserted so income isn't duplicated.
    await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(financeTransactionId).run();
    return jsonError('Bàn này vừa được chốt hoặc huỷ bởi thao tác khác, vui lòng tải lại', 409);
  }

  return new Response(JSON.stringify({ ok: true, totalAmount: totals.total, financeTransactionId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
