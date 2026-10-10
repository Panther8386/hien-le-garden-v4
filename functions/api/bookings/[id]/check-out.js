import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { computeRoomTotal } from '../../../../lib/roomPricing.js';
import { canSeeHidden } from '../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_PAYMENT_METHODS = ['cash', 'transfer'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'bookings.manage');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without bookings.view answer like a missing id.
  if (!hasPermission(auth, 'bookings.view')) return jsonError('Không tìm thấy đặt phòng', 404);

  const booking = await env.DB.prepare(
    `SELECT bk.id, bk.status, bk.room_id, bk.room_type, bk.check_in, bk.check_out, bk.guest_name, bk.deposit_amount, bk.is_hidden,
            r.price_weekday AS priceWeekday, r.price_weekend AS priceWeekend
     FROM bookings bk LEFT JOIN rooms r ON r.id = bk.room_id
     WHERE bk.id = ?`
  ).bind(params.id).first();
  // A hidden booking answers exactly like a non-existent id for anyone without records.hide.
  if (!booking || !canSeeHidden(auth, booking)) {
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
    `SELECT start_date AS startDate, end_date AS endDate FROM holidays ORDER BY start_date, end_date`
  ).all();
  const roomTotal = computeRoomTotal(
    booking.check_in, booking.check_out,
    { roomType: booking.room_type, priceWeekday: booking.priceWeekday, priceWeekend: booking.priceWeekend },
    holidayRows
  );

  // Capture both the amount and the exact service rows used for this settlement.
  const serviceSnapshotSql = `SELECT json_group_array(json_array(id, amount, status, payment_status)) FROM
    (SELECT id, amount, status, payment_status FROM booking_service_items WHERE booking_id = ? ORDER BY id)`;
  const unpaidRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'posted' AND payment_status = 'pending' THEN amount ELSE 0 END), 0) AS total,
      (${serviceSnapshotSql}) AS snapshot FROM booking_service_items WHERE booking_id = ?`
  ).bind(params.id, params.id).first();
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
  try {
    // A unique audit entry gates every write inside this atomic batch. If the
    // snapshot has changed, none of the checkout side effects may run.
    const settlement = JSON.stringify({ key: crypto.randomUUID(), roomDue, servicesDue, refundAmount });
    const stillCheckedIn = `EXISTS (SELECT 1 FROM audit_log WHERE action_type = 'booking_checkout'
      AND entity_type = 'booking' AND entity_id = ? AND new_value = ?)`;
    const statements = [env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       SELECT 'booking_checkout', 'booking', ?, ?, 'checked_in', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM bookings bk LEFT JOIN rooms r ON r.id = bk.room_id
         WHERE bk.id = ? AND bk.status = 'checked_in' AND COALESCE(bk.deposit_amount, 0) = ?
           AND bk.room_id IS ? AND bk.room_type = ? AND bk.check_in = ? AND bk.check_out = ?
           AND r.price_weekday IS ? AND r.price_weekend IS ?)
         AND (${serviceSnapshotSql}) = ?
         AND (SELECT json_group_array(json_array(start_date, end_date)) FROM
           (SELECT start_date, end_date FROM holidays ORDER BY start_date, end_date)) = ?`
    ).bind(params.id, booking.guest_name, settlement, auth.username, now,
      params.id, deposit, booking.room_id, booking.room_type, booking.check_in, booking.check_out,
      booking.priceWeekday, booking.priceWeekend, params.id, unpaidRow.snapshot,
      JSON.stringify(holidayRows.map(h => [h.startDate, h.endDate])))];
    // Receipt creation belongs to the same transaction as the audit gate,
    // service settlement and final booking transition. No compensating DELETEs.
    for (const [type, category, amount, note] of [
      ['income', 'dich_vu', roomDue, `Tiền phòng — ${booking.guest_name}`],
      ['income', 'ban_hang', servicesDue, `Dịch vụ lưu trú — ${booking.guest_name}`],
      ['expense', 'hoan_coc', refundAmount, `Hoàn cọc dư — ${booking.guest_name}`],
    ]) {
      if (amount > 0) statements.push(env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, checkout_booking_id)
         SELECT ?, ?, ?, ?, ?, 'confirmed', ?, ?, ? WHERE ${stillCheckedIn}`
      ).bind(type, category, amount, note, today, auth.username, now, params.id, params.id, settlement));
    }
    if (booking.room_id) {
      statements.push(
        env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = ? WHERE id = ? AND ${stillCheckedIn}`)
          .bind(now, booking.room_id, params.id, settlement)
      );
    }
    statements.push(
      env.DB.prepare(
        `UPDATE booking_service_items SET payment_status = 'paid', payment_method = ? WHERE booking_id = ? AND status = 'posted' AND payment_status = 'pending' AND ${stillCheckedIn}`
      ).bind(resolvedPaymentMethod, params.id, params.id, settlement)
    );
    statements.push(
      env.DB.prepare(`UPDATE bookings SET status = 'checked_out', checkout_payment_method = ? WHERE id = ? AND status = 'checked_in' AND ${stillCheckedIn}`).bind(resolvedPaymentMethod, params.id, params.id, settlement)
    );

    const results = await env.DB.batch(statements);
    if (results[results.length - 1].meta.changes === 0) {
      // Thao tác khác vừa check-out đặt phòng này giữa lúc đọc và ghi (race condition).
      return jsonError('Đặt phòng hoặc dịch vụ vừa thay đổi, vui lòng tải lại và kiểm tra số tiền trước khi check-out', 409);
    }

    return new Response(
      JSON.stringify({ ok: true, roomDue, servicesDue, refundAmount, checkoutPaymentMethod: resolvedPaymentMethod }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // D1 rolls back all receipts, audit, services and cleaning flags on failure.
    return jsonError('Có lỗi khi check-out, vui lòng thử lại', 500);
  }
}
