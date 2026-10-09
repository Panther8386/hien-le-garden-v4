import { atomicSaleClose } from '../../../../lib/atomicSaleClose.js';
import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { canSeeHidden } from '../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'gio_xanh.manage');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without gio_xanh.view answer like a missing id.
  if (!hasPermission(auth, 'gio_xanh.view')) return jsonError('Không tìm thấy phiên', 404);

  const session = await env.DB.prepare(
    `SELECT s.id, s.guest_name AS guestName, s.status, r.name AS roomName, s.is_hidden
     FROM gio_xanh_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.id = ?`
  ).bind(params.id).first();
  // A hidden session answers exactly like a non-existent id for anyone without records.hide.
  if (!session || !canSeeHidden(auth, session)) return jsonError('Không tìm thấy phiên', 404);
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

  try {
    const result = await atomicSaleClose(env.DB, {
      kind: 'gio_xanh', id: params.id, total: totals.total, count: totals.n,
      label: `${session.roomName} — ${session.guestName}`, note, actor: auth.username, now, paymentMethod,
    });
    if (!result.closed) return jsonError('Phiên hoặc dịch vụ vừa thay đổi, vui lòng tải lại và kiểm tra số tiền trước khi chốt', 409);
    return new Response(JSON.stringify({ ok: true, totalAmount: totals.total, financeTransactionId: result.financeTransactionId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // D1 rolls back the receipt, audit and parent update together on failure.
    return jsonError('Có lỗi khi chốt phiên, vui lòng thử lại', 500);
  }
}
