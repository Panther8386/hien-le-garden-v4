import { requireAuth } from '../../../../lib/requireAuth.js';
import { computeRoomTotal } from '../../../../lib/roomPricing.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(
    `SELECT bk.id, bk.status, bk.room_id, bk.room_type, bk.check_in, bk.check_out, bk.guest_name, bk.deposit_amount,
            r.price_weekday AS priceWeekday, r.price_weekend AS priceWeekend
     FROM bookings bk LEFT JOIN rooms r ON r.id = bk.room_id
     WHERE bk.id = ?`
  ).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'checked_in') {
    return jsonError('Chỉ có thể check-out từ trạng thái đang lưu trú', 400);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    body = {};
  }
  body = body || {};
  const { paymentMethod } = body;

  const { results: holidayRows } = await env.DB.prepare(
    `SELECT start_date AS startDate, end_date AS endDate FROM holidays`
  ).all();
  const roomTotal = computeRoomTotal(
    booking.check_in, booking.check_out,
    { roomType: booking.room_type, priceWeekday: booking.priceWeekday, priceWeekend: booking.priceWeekend },
    holidayRows
  );

  const unpaidRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM booking_service_items WHERE booking_id = ? AND status = 'posted' AND payment_status = 'pending'`
  ).bind(params.id).first();
  const unpaidServicesTotal = unpaidRow.total;

  const deposit = booking.deposit_amount || 0;
  const roomDue = Math.max(roomTotal - deposit, 0);
  const leftoverDeposit = Math.max(deposit - roomTotal, 0);
  const servicesDue = Math.max(unpaidServicesTotal - leftoverDeposit, 0);
  const refundAmount = Math.max(leftoverDeposit - unpaidServicesTotal, 0);

  // A payment method is needed whenever cash actually changes hands (room/services due, or a
  // refund), OR whenever a pending service item is being marked paid — even if the deposit fully
  // absorbs its amount (servicesDue === 0) — because that settlement still needs a payment_method
  // recorded on the booking_service_items row.
  const needsPaymentMethod = roomDue > 0 || servicesDue > 0 || refundAmount > 0 || unpaidServicesTotal > 0;
  if (needsPaymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return jsonError('Vui lòng chọn hình thức thanh toán', 400);
  }
  const resolvedPaymentMethod = needsPaymentMethod ? paymentMethod : null;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const createdTransactionIds = [];

  async function cleanupCreatedTransactions() {
    for (const id of createdTransactionIds) {
      try {
        await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ?`).bind(id).run();
      } catch (cleanupErr) {
        // Bỏ qua lỗi dọn dẹp — không để nó che lấp lỗi gốc bên dưới.
      }
    }
  }

  try {
    if (roomDue > 0) {
      const insert = await env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
         VALUES ('income', 'dich_vu', ?, ?, ?, 'confirmed', ?, ?)`
      ).bind(roomDue, `Tiền phòng — ${booking.guest_name}`, today, auth.username, now).run();
      createdTransactionIds.push(insert.meta.last_row_id);
    }

    if (servicesDue > 0) {
      const insert = await env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
         VALUES ('income', 'ban_hang', ?, ?, ?, 'confirmed', ?, ?)`
      ).bind(servicesDue, `Dịch vụ lưu trú — ${booking.guest_name}`, today, auth.username, now).run();
      createdTransactionIds.push(insert.meta.last_row_id);
    }

    if (refundAmount > 0) {
      const insert = await env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at)
         VALUES ('expense', 'hoan_coc', ?, ?, ?, 'confirmed', ?, ?)`
      ).bind(refundAmount, `Hoàn cọc dư — ${booking.guest_name}`, today, auth.username, now).run();
      createdTransactionIds.push(insert.meta.last_row_id);
    }

    const statements = [
      env.DB.prepare(`UPDATE bookings SET status = 'checked_out', checkout_payment_method = ? WHERE id = ? AND status = 'checked_in'`).bind(resolvedPaymentMethod, params.id),
    ];
    if (booking.room_id) {
      statements.push(env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = ? WHERE id = ?`).bind(now, booking.room_id));
    }
    statements.push(
      env.DB.prepare(
        `UPDATE booking_service_items SET payment_status = 'paid', payment_method = ? WHERE booking_id = ? AND status = 'posted' AND payment_status = 'pending'`
      ).bind(resolvedPaymentMethod, params.id)
    );

    const results = await env.DB.batch(statements);
    if (results[0].meta.changes === 0) {
      // Thao tác khác vừa check-out đặt phòng này giữa lúc đọc và ghi (race condition).
      await cleanupCreatedTransactions();
      return jsonError('Đặt phòng này vừa được check-out bởi thao tác khác, vui lòng tải lại', 409);
    }

    return new Response(
      JSON.stringify({ ok: true, roomDue, servicesDue, refundAmount, checkoutPaymentMethod: resolvedPaymentMethod }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // Lỗi bất ngờ giữa lúc ghi các dòng thu/chi và cập nhật đặt phòng (vd: lỗi DB tạm thời).
    await cleanupCreatedTransactions();
    return jsonError('Có lỗi khi check-out, vui lòng thử lại', 500);
  }
}
