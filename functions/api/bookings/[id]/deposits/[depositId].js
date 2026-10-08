import { requireAuth } from '../../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../../lib/permissions.js';
import { canSeeHidden } from '../../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, 'bookings.deposit_delete');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without bookings.view answer like a missing id.
  if (!hasPermission(auth, 'bookings.view')) return jsonError('Không tìm thấy đặt phòng', 404);

  // Load and check the parent booking's visibility first, before any deposit-specific
  // validation, so a hidden booking's deposits answer exactly like a non-existent id.
  const booking = await env.DB.prepare(
    `SELECT status, guest_name, is_hidden, refund_finance_transaction_id FROM bookings WHERE id = ?`
  ).bind(params.id).first();
  if (!booking || !canSeeHidden(auth, booking)) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }

  const deposit = await env.DB.prepare(
    `SELECT id, booking_id, amount, finance_transaction_id, voided_at FROM booking_deposits WHERE id = ?`
  ).bind(params.depositId).first();
  if (!deposit || String(deposit.booking_id) !== String(params.id)) {
    return jsonError('Không tìm thấy dòng cọc', 404);
  }
  if (deposit.voided_at) {
    return jsonError('Dòng cọc này đã bị xoá trước đó', 400);
  }

  // A cancelled booking's deposit may only be removed to reconcile it with the ledger: its
  // income row was already voided in Thu chi and no refund was paid against the booking.
  // Anything else (checked_out, live income row, legacy row without a link, refunded) stays blocked.
  const cancelledReconcile = booking.status === 'cancelled';
  if (booking.status === 'checked_out') {
    return jsonError('Chỉ có thể xoá cọc khi đặt phòng còn đang chờ, đã xác nhận, hoặc đang lưu trú', 400);
  }
  if (cancelledReconcile) {
    const income = deposit.finance_transaction_id
      ? await env.DB.prepare(`SELECT type, voided_at FROM finance_transactions WHERE id = ?`).bind(deposit.finance_transaction_id).first()
      : null;
    if (!income || income.type !== 'income' || !income.voided_at || booking.refund_finance_transaction_id) {
      return jsonError('Đặt phòng đã huỷ: chỉ xoá được dòng cọc khi khoản thu tương ứng đã được huỷ trong Thu chi và chưa hoàn cọc', 400);
    }
  }

  const now = new Date().toISOString();

  // D1 batch is atomic. Each later write is gated by changes() from the previous
  // write so a race loser cannot decrement twice or create an audit/finance change.
  const reconcileGuard = cancelledReconcile
    ? ` AND refund_finance_transaction_id IS NULL
        AND EXISTS (SELECT 1 FROM finance_transactions f WHERE f.id = ? AND f.type = 'income' AND f.voided_at IS NOT NULL)`
    : '';
  const bookingArgs = [deposit.amount, params.id, booking.status, deposit.amount, deposit.id, deposit.amount, deposit.finance_transaction_id];
  if (cancelledReconcile) bookingArgs.push(deposit.finance_transaction_id);
  const statements = [
    env.DB.prepare(`UPDATE bookings SET deposit_amount = deposit_amount - ?
      WHERE id = ? AND status = ? AND deposit_amount >= ?
        AND EXISTS (SELECT 1 FROM booking_deposits d WHERE d.id = ? AND d.booking_id = bookings.id AND d.amount = ? AND d.finance_transaction_id IS ? AND d.voided_at IS NULL)
        ${reconcileGuard}`).bind(...bookingArgs),
    env.DB.prepare(`UPDATE booking_deposits SET voided_by = ?, voided_at = ?
      WHERE id = ? AND booking_id = ? AND voided_at IS NULL AND changes() > 0`)
      .bind(auth.username, now, deposit.id, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       SELECT 'deposit_delete', 'booking_deposit', ?, ?, ?, NULL, ?, ? WHERE changes() > 0`
    ).bind(deposit.id, booking.guest_name, String(deposit.amount), auth.username, now),
  ];
  if (deposit.finance_transaction_id) {
    statements.push(
      env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL AND changes() > 0`)
        .bind(auth.username, now, deposit.finance_transaction_id)
    );
  }
  try {
    const results = await env.DB.batch(statements);
    if (results[0].meta.changes === 0) return jsonError('Dòng cọc này vừa được xử lý bởi thao tác khác, vui lòng tải lại', 409);
  } catch {
    return jsonError('Có lỗi khi xoá cọc, vui lòng thử lại', 500);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
