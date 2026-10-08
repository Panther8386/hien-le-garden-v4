import { requireAuth } from './requireAuth.js';
import { hasPermission } from './permissions.js';
import { canSeeHidden } from './hiddenAccess.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const error = (message, status) => json({ error: message }, status);

// Separate business rules share the same atomic financial transition.
export async function cancelBooking({ request, env, params }, expectedStatus) {
  const hotel = expectedStatus === 'pending';
  let pending = hotel;
  const auth = await requireAuth(request, env, 'bookings.manage');
  if (auth instanceof Response) return auth;
  const missing = pending ? 'Không tìm thấy yêu cầu đặt phòng' : 'Không tìm thấy đặt phòng';
  if (!hasPermission(auth, 'bookings.view')) return error(missing, 404);
  let body = {};
  try { body = (await request.json()) || {}; } catch { /* Body is optional. */ }
  const { reason, paymentMethod, requestSource, requestedAt } = body;
  if (reason != null && (typeof reason !== 'string' || reason.length > 1000)) return error('Lý do huỷ không hợp lệ', 400);
  if (requestSource != null && !['phone', 'zalo', 'in_person'].includes(requestSource)) return error('Nguồn yêu cầu không hợp lệ', 400);
  if (requestedAt != null && (typeof requestedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(requestedAt))) return error('Thời điểm tiếp nhận không hợp lệ', 400);
  const booking = await env.DB.prepare(
    `SELECT id, status, check_in, deposit_amount, guest_name, is_hidden, created_at FROM bookings WHERE id = ?`
  ).bind(params.id).first();
  if (!booking || !canSeeHidden(auth, booking)) return error(missing, 404);
  const invalidState = pending ? 'Yêu cầu này không còn ở trạng thái chờ xử lý' : 'Chỉ có thể huỷ đặt phòng đã xác nhận';
  if (hotel ? booking.status !== 'pending' : !['pending', 'confirmed'].includes(booking.status)) return error(invalidState, 400);
  pending = booking.status === 'pending';
  expectedStatus = booking.status;
  // Confirmed-booking clients without metadata retain the existing API contract;
  // the new UI always supplies the complete customer request record.
  if (!hotel && (pending || requestedAt != null || requestSource != null) && (!reason?.trim() || !requestSource || !requestedAt)) return error('Vui lòng nhập lý do, nguồn và thời điểm tiếp nhận yêu cầu', 400);

  const now = new Date();
  const received = hotel ? now : new Date(requestedAt ?? now.toISOString());
  if (!Number.isFinite(received.getTime()) || (!hotel && requestedAt && received.toISOString() !== requestedAt) || received > now || received < new Date(booking.created_at)) return error('Thời điểm tiếp nhận phải từ lúc tạo booking đến hiện tại', 400);
  const [y, m, d] = booking.check_in.split('-').map(Number);
  const localDate = new Date(received.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const daysBefore = Math.floor((Date.UTC(y, m - 1, d) - Date.parse(localDate)) / 86400000);
  const tier = await env.DB.prepare(
    `SELECT refund_percent FROM cancellation_policy_tier WHERE min_days_before_checkin <= ? ORDER BY min_days_before_checkin DESC LIMIT 1`
  ).bind(daysBefore).first();
  const refundPercentApplied = hotel ? 100 : (tier ? tier.refund_percent : 0);
  const deposit = booking.deposit_amount || 0;
  const refundAmount = Math.round(deposit * refundPercentApplied / 100);
  if (refundAmount > 0 && !['cash', 'transfer'].includes(paymentMethod)) return error('Vui lòng chọn hình thức thanh toán', 400);
  const method = refundAmount > 0 ? paymentMethod : null;
  const timestamp = now.toISOString();
  let auditValue = pending && deposit === 0 ? 'cancelled' : `cancelled — hoàn ${refundPercentApplied}% (${refundAmount} đ)`;
  if (reason) auditValue += ` — Lý do: ${reason}`;
  auditValue += ` — ${hotel ? 'Khách sạn từ chối' : 'Khách yêu cầu huỷ'}; nguồn: ${hotel ? 'unknown' : (requestSource || 'unknown')}; tiếp nhận: ${received.toISOString()}`;
  // This state is an internal endpoint constant, never request data.
  const guard = `id = ? AND status = '${pending ? 'pending' : 'confirmed'}' AND COALESCE(deposit_amount, 0) = ?`;
  try {
    // One transaction: link the refund rowid immediately, then write the audit only
    // if the preceding UPDATE won. Failure rolls back every write; losers insert nothing.
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
         SELECT 'expense', 'hoan_coc', ?, ?, ?, 'confirmed', ?, ?
         WHERE ? > 0 AND EXISTS (SELECT 1 FROM bookings WHERE ${guard})`
      ).bind(refundAmount, `Hoàn cọc huỷ đặt phòng — ${booking.guest_name}`, timestamp.slice(0, 10), auth.username, timestamp, refundAmount, params.id, deposit),
      env.DB.prepare(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = ?, refund_percent_applied = ?,
         refund_finance_transaction_id = CASE WHEN ? > 0 THEN last_insert_rowid() ELSE NULL END,
         cancel_refund_payment_method = ?, cancellation_origin = ?, cancellation_request_source = ?,
         cancellation_requested_at = ?, cancelled_at = ?, cancelled_by = ? WHERE ${guard}`
      ).bind(reason || null, refundPercentApplied, refundAmount, method, hotel ? 'hotel' : 'guest', hotel ? 'unknown' : (requestSource || 'unknown'), received.toISOString(), timestamp, auth.username, params.id, deposit),
      env.DB.prepare(
        `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
         SELECT ?, 'booking', ?, ?, ?, ?, ?, ? WHERE changes() > 0`
      ).bind(hotel ? 'booking_reject' : 'booking_cancel', booking.id, booking.guest_name, expectedStatus, auditValue, auth.username, timestamp),
    ]);
    if (results[1].meta.changes === 0) {
      const current = await env.DB.prepare('SELECT status FROM bookings WHERE id = ?').bind(params.id).first();
      if (hotel && current?.status !== 'pending') return error(invalidState, 400);
      return error('Đặt phòng này vừa được xử lý bởi thao tác khác, vui lòng tải lại', 409);
    }
    return json({ ok: true, refundPercentApplied, refundAmount });
  } catch {
    return error('Có lỗi khi huỷ đặt phòng, vui lòng thử lại', 500);
  }
}
