import { readJsonBody } from '../../../../lib/readJsonBody.js';
import { json, jsonError, NOT_FOUND, requireOrderPermission } from '../../../../lib/serviceOrders.js';

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'records.hide');
  if (auth instanceof Response) return auth;
  const order = await env.DB.prepare('SELECT id, status, is_hidden FROM service_orders WHERE id = ?').bind(params.id).first();
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!['settled', 'cancelled'].includes(order.status)) return jsonError('Chỉ ẩn được đơn đã tất toán hoặc đã huỷ', 400);
  const parsed = await readJsonBody(request, { maxBytes: 256 });
  if (!parsed.ok) return parsed.response;
  if (typeof parsed.body.hidden !== 'boolean') return jsonError('Dữ liệu không hợp lệ', 400);
  const hidden = parsed.body.hidden;
  const now = new Date().toISOString();
  // old/new values use the lowercase 'ẩn'/'hiện' of bookings' record_hide audit rows.
  await env.DB.batch([
    env.DB.prepare(`UPDATE service_orders SET is_hidden = ? WHERE id = ? AND status IN ('settled', 'cancelled')`).bind(hidden ? 1 : 0, order.id),
    env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      SELECT 'record_hide', 'service_order', ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
      .bind(order.id, `Đơn #${order.id}`, order.is_hidden ? 'ẩn' : 'hiện', hidden ? 'ẩn' : 'hiện', auth.username, now),
  ]);
  return json({ ok: true });
}
