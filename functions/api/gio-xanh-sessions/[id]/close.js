import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const session = await env.DB.prepare(
    `SELECT s.id, s.guest_name AS guestName, s.status, r.name AS roomName
     FROM gio_xanh_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.id = ?`
  ).bind(params.id).first();
  if (!session) return jsonError('Không tìm thấy phiên', 404);
  if (session.status !== 'open') return jsonError('Chỉ có thể chốt khi phiên còn đang mở', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { paymentMethod } = body || {};
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) return jsonError('Vui lòng chọn hình thức thanh toán', 400);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM gio_xanh_session_items WHERE session_id = ? AND status = 'posted'`
  ).bind(params.id).first();
  if (totals.n === 0) return jsonError('Phiên chưa có dòng nào, vui lòng huỷ phiên thay vì chốt', 400);

  const now = new Date().toISOString();
  const note = `Giờ Xanh — Phòng ${session.roomName} — ${session.guestName}`;

  let financeTransactionId;
  try {
    const txInsert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
       VALUES ('income', 'gio_xanh_hien_le', ?, ?, ?, 'confirmed', ?, ?)`
    ).bind(totals.total, note, now.slice(0, 10), auth.username, now).run();
    financeTransactionId = txInsert.meta.last_row_id;

    const sessionUpdate = await env.DB.prepare(
      `UPDATE gio_xanh_sessions SET status = 'closed', closed_by = ?, closed_at = ?, payment_method = ?, total_amount = ?, finance_transaction_id = ? WHERE id = ? AND status = 'open'`
    ).bind(auth.username, now, paymentMethod, totals.total, financeTransactionId, params.id).run();

    if (sessionUpdate.meta.changes === 0) {
      // Thao tác khác vừa đóng/huỷ phiên này giữa lúc đọc và ghi (race condition).
      // Xoá dòng finance_transactions vừa tạo để tránh trùng doanh thu.
      await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(financeTransactionId).run();
      return jsonError('Phiên này vừa được chốt hoặc huỷ bởi thao tác khác, vui lòng tải lại', 409);
    }

    return new Response(JSON.stringify({ ok: true, totalAmount: totals.total, financeTransactionId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // Lỗi bất ngờ giữa lúc tạo dòng thu và cập nhật phiên (vd: lỗi DB tạm thời).
    // Cố gắng dọn dẹp dòng finance_transactions vừa tạo (nếu có) để tránh doanh thu ma.
    if (financeTransactionId) {
      try {
        await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(financeTransactionId).run();
      } catch (cleanupErr) {
        // Bỏ qua lỗi dọn dẹp — không để nó che lấp lỗi gốc bên dưới.
      }
    }
    return jsonError('Có lỗi khi chốt phiên, vui lòng thử lại', 500);
  }
}
