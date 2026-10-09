import { atomicSaleClose } from '../../../../lib/atomicSaleClose.js';
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

  try {
    const result = await atomicSaleClose(env.DB, {
      kind: 'dine_in', id: params.id, total: totals.total, count: totals.n,
      label: order.tableLabel, note, actor: auth.username, now, paymentMethod,
    });
    if (!result.closed) return jsonError('Bàn này vừa được chốt hoặc huỷ bởi thao tác khác, vui lòng tải lại', 409);
    return new Response(JSON.stringify({ ok: true, totalAmount: totals.total, financeTransactionId: result.financeTransactionId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // D1 rolls back the receipt, audit and parent update together on failure.
    return jsonError('Có lỗi khi chốt bàn, vui lòng thử lại', 500);
  }
}
