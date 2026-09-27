import { requireAuth } from '../../../../lib/requireAuth.js';
import { canSeeHidden } from '../../../../lib/hiddenAccess.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, 'bookings.manage');
  if (auth instanceof Response) return auth;

  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    body = {};
  }
  body = body || {};
  const { reason } = body;

  const booking = await env.DB.prepare(`SELECT id, status, guest_name, is_hidden FROM bookings WHERE id = ?`).bind(params.id).first();
  // A hidden booking answers exactly like a non-existent id for anyone without records.hide.
  if (!booking || !canSeeHidden(auth, booking)) {
    return jsonError('Không tìm thấy yêu cầu đặt phòng', 404);
  }
  if (booking.status !== 'pending') {
    return jsonError('Yêu cầu này không còn ở trạng thái chờ xử lý', 400);
  }

  let newValue = 'cancelled';
  if (reason) newValue += ` — Lý do: ${reason}`;
  const now = new Date().toISOString();

  // One D1 batch = one transaction. The audit row is written FIRST and only if the booking is
  // still 'pending'; the guarded UPDATE follows. Both see the same state, so if a competing
  // transition landed after the pre-check, neither statement changes anything.
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       SELECT 'booking_reject', 'booking', ?, ?, 'pending', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'pending')`
    ).bind(booking.id, booking.guest_name, newValue, auth.username, now, params.id),
    env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ? AND status = 'pending'`).bind(reason || null, params.id),
  ]);
  if (results[1].meta.changes === 0) {
    return jsonError('Yêu cầu này không còn ở trạng thái chờ xử lý', 400);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
