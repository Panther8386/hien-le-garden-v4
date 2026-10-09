import { requireAuth } from '../../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../../lib/permissions.js';
import { canSeeHidden } from '../../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, 'bookings.manage');
  if (auth instanceof Response) return auth;
  // Mutating requires seeing the resource: without bookings.view answer like a missing id.
  if (!hasPermission(auth, 'bookings.view')) return jsonError('Không tìm thấy dòng dịch vụ', 404);

  const item = await env.DB.prepare(
    `SELECT bsi.id, bsi.booking_id, bsi.status, bsi.payment_status, bsi.finance_transaction_id, bsi.name, bsi.quantity, b.guest_name AS guestName, b.status AS bookingStatus, b.is_hidden
     FROM booking_service_items bsi JOIN bookings b ON b.id = bsi.booking_id
     WHERE bsi.id = ?`
  ).bind(params.itemId).first();
  if (!item || String(item.booking_id) !== String(params.id)) {
    return jsonError('Không tìm thấy dòng dịch vụ', 404);
  }
  // A hidden parent booking answers exactly like a non-existent id for anyone without records.hide.
  if (!canSeeHidden(auth, item)) {
    return jsonError('Không tìm thấy dòng dịch vụ', 404);
  }
  if (item.status === 'voided') {
    return jsonError('Dòng dịch vụ này đã được huỷ trước đó', 400);
  }
  if (item.payment_status === 'paid' && !hasPermission(auth, 'bookings.edit_paid_service')) {
    return jsonError('Bạn không có quyền sửa/xoá dịch vụ đã thanh toán', 403);
  }

  if (!['confirmed', 'checked_in'].includes(item.bookingStatus)) return jsonError('Chỉ có thể huỷ dịch vụ khi đặt phòng còn hoạt động', 400);

  const now = new Date().toISOString();
  const entityLabel = `${item.name} ×${item.quantity} — ${item.guestName}`;

  const stillVoidable = `EXISTS (SELECT 1 FROM booking_service_items si JOIN bookings p ON p.id = si.booking_id
    WHERE si.id = ? AND si.status = 'posted' AND p.status IN ('confirmed', 'checked_in') AND si.payment_status = ?)`;
  const statements = [
    env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      SELECT 'service_void', 'service_item', ?, ?, 'posted', 'voided', ?, ? WHERE ${stillVoidable}`)
      .bind(item.id, entityLabel, auth.username, now, params.itemId, item.payment_status),
  ];
  if (item.payment_status === 'paid') {
    statements.push(env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ? AND ${stillVoidable}`)
      .bind(auth.username, now, item.finance_transaction_id, params.itemId, item.payment_status));
  }
  statements.push(
    env.DB.prepare(`UPDATE booking_service_items SET status = 'voided', voided_by = ?, voided_at = ? WHERE id = ? AND ${stillVoidable}`)
      .bind(auth.username, now, params.itemId, params.itemId, item.payment_status)
  );
  const results = await env.DB.batch(statements);
  if (results[results.length - 1].meta.changes === 0) return jsonError('Dịch vụ hoặc trạng thái vừa thay đổi, vui lòng tải lại', 409);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
