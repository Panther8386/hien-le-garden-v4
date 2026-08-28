import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM cancellation_policy_tier WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy bậc chính sách', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  const minDaysBeforeCheckin = body.minDaysBeforeCheckin !== undefined ? body.minDaysBeforeCheckin : existing.min_days_before_checkin;
  const refundPercent = body.refundPercent !== undefined ? body.refundPercent : existing.refund_percent;
  const label = body.label !== undefined ? body.label : existing.label;
  const displayOrder = body.displayOrder !== undefined ? body.displayOrder : existing.display_order;

  if (!Number.isInteger(minDaysBeforeCheckin) || minDaysBeforeCheckin < 0) {
    return jsonError('Số ngày tối thiểu phải là số nguyên không âm', 400);
  }
  if (!Number.isInteger(refundPercent) || refundPercent < 0 || refundPercent > 100) {
    return jsonError('Phần trăm hoàn cọc phải là số nguyên từ 0 đến 100', 400);
  }

  await env.DB.prepare(
    `UPDATE cancellation_policy_tier SET min_days_before_checkin = ?, refund_percent = ?, label = ?, display_order = ?, updated_by = ?, updated_at = ? WHERE id = ?`
  )
    .bind(minDaysBeforeCheckin, refundPercent, label || null, Number.isInteger(displayOrder) ? displayOrder : 0, auth.username, new Date().toISOString(), params.id)
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT id FROM cancellation_policy_tier WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy bậc chính sách', 404);

  await env.DB.prepare(`DELETE FROM cancellation_policy_tier WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
