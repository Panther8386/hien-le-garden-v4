import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
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

  const booking = await env.DB.prepare(`SELECT id, status, guest_name FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy yêu cầu đặt phòng', 404);
  }
  if (booking.status !== 'pending') {
    return jsonError('Yêu cầu này không còn ở trạng thái chờ xử lý', 400);
  }

  let newValue = 'cancelled';
  if (reason) newValue += ` — Lý do: ${reason}`;
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ?`).bind(reason || null, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('booking_reject', 'booking', ?, ?, 'pending', ?, ?, ?)`
    ).bind(booking.id, booking.guest_name, newValue, auth.username, now),
  ]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
