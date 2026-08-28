import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

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
  const { reason } = body;

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

  let newValue = `cancelled — hoàn ${refundPercentApplied}% (${refundAmount} đ)`;
  if (reason) newValue += ` — Lý do: ${reason}`;
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled', cancel_reason = ?, refund_percent_applied = ? WHERE id = ?`
    ).bind(reason || null, refundPercentApplied, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('booking_cancel', 'booking', ?, ?, 'confirmed', ?, ?, ?)`
    ).bind(booking.id, booking.guest_name, newValue, auth.username, now),
  ]);

  return new Response(
    JSON.stringify({ ok: true, refundPercentApplied, refundAmount }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
