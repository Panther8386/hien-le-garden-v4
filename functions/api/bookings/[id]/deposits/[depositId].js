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
  const booking = await env.DB.prepare(`SELECT status, guest_name, is_hidden FROM bookings WHERE id = ?`).bind(params.id).first();
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

  if (booking.status === 'checked_out' || booking.status === 'cancelled') {
    return jsonError('Chỉ có thể xoá cọc khi đặt phòng còn đang chờ, đã xác nhận, hoặc đang lưu trú', 400);
  }

  const now = new Date().toISOString();

  // Standalone, guarded — must NOT be batched with the statements below.
  // env.DB.batch() runs every statement regardless of whether an earlier
  // one matched zero rows, so a race-losing request could otherwise still
  // execute the deposit_amount decrement a second time.
  const voidResult = await env.DB.prepare(
    `UPDATE booking_deposits SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL`
  ).bind(auth.username, now, params.depositId).run();

  if (voidResult.meta.changes === 0) {
    return jsonError('Dòng cọc này vừa được xử lý bởi thao tác khác, vui lòng tải lại', 409);
  }

  const statements = [
    env.DB.prepare(`UPDATE bookings SET deposit_amount = deposit_amount - ? WHERE id = ?`).bind(deposit.amount, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('deposit_delete', 'booking_deposit', ?, ?, ?, NULL, ?, ?)`
    ).bind(deposit.id, booking.guest_name, String(deposit.amount), auth.username, now),
  ];
  if (deposit.finance_transaction_id) {
    statements.push(
      env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL`)
        .bind(auth.username, now, deposit.finance_transaction_id)
    );
  }
  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
