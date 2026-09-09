import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

function daysBeforeCheckin(checkIn) {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = checkIn.split('-').map(Number);
  const checkInUTC = Date.UTC(y, m - 1, d);
  return Math.floor((checkInUTC - todayUTC) / 86400000);
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    body = {};
  }
  body = body || {};
  const { reason, paymentMethod } = body;

  const booking = await env.DB.prepare(`SELECT id, status, check_in, deposit_amount, guest_name FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'confirmed') {
    return jsonError('Chỉ có thể huỷ đặt phòng đã xác nhận', 400);
  }

  const daysBefore = daysBeforeCheckin(booking.check_in);
  const tier = await env.DB.prepare(
    `SELECT refund_percent FROM cancellation_policy_tier WHERE min_days_before_checkin <= ? ORDER BY min_days_before_checkin DESC LIMIT 1`
  ).bind(daysBefore).first();
  const refundPercentApplied = tier ? tier.refund_percent : 0;
  const refundAmount = Math.round((booking.deposit_amount || 0) * refundPercentApplied / 100);

  if (refundAmount > 0 && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return jsonError('Vui lòng chọn hình thức thanh toán', 400);
  }
  const resolvedPaymentMethod = refundAmount > 0 ? paymentMethod : null;

  let newValue = `cancelled — hoàn ${refundPercentApplied}% (${refundAmount} đ)`;
  if (reason) newValue += ` — Lý do: ${reason}`;
  const now = new Date().toISOString();

  let refundFinanceTransactionId = null;
  try {
    if (refundAmount > 0) {
      const insert = await env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
         VALUES ('expense', 'hoan_coc', ?, ?, ?, 'confirmed', ?, ?)`
      ).bind(refundAmount, `Hoàn cọc huỷ đặt phòng — ${booking.guest_name}`, now.slice(0, 10), auth.username, now).run();
      refundFinanceTransactionId = insert.meta.last_row_id;
    }

    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = ?, refund_percent_applied = ?, refund_finance_transaction_id = ?, cancel_refund_payment_method = ? WHERE id = ? AND status = 'confirmed'`
      ).bind(reason || null, refundPercentApplied, refundFinanceTransactionId, resolvedPaymentMethod, params.id),
      env.DB.prepare(
        `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
         VALUES ('booking_cancel', 'booking', ?, ?, 'confirmed', ?, ?, ?)`
      ).bind(booking.id, booking.guest_name, newValue, auth.username, now),
    ]);

    if (results[0].meta.changes === 0) {
      // Thao tác khác vừa xử lý đặt phòng này giữa lúc đọc và ghi (race condition).
      if (refundFinanceTransactionId) {
        await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(refundFinanceTransactionId).run();
      }
      return jsonError('Đặt phòng này vừa được xử lý bởi thao tác khác, vui lòng tải lại', 409);
    }

    return new Response(
      JSON.stringify({ ok: true, refundPercentApplied, refundAmount }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // Lỗi bất ngờ giữa lúc ghi dòng hoàn cọc và cập nhật đặt phòng (vd: lỗi DB tạm thời).
    if (refundFinanceTransactionId) {
      try {
        await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(refundFinanceTransactionId).run();
      } catch (cleanupErr) {
        // Bỏ qua lỗi dọn dẹp — không để nó che lấp lỗi gốc bên dưới.
      }
    }
    return jsonError('Có lỗi khi huỷ đặt phòng, vui lòng thử lại', 500);
  }
}
