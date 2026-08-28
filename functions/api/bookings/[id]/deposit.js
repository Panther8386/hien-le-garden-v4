import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { depositAmount } = body || {};

  if (!Number.isInteger(depositAmount) || depositAmount < 0) {
    return jsonError('Số tiền cọc phải là số nguyên không âm', 400);
  }

  const booking = await env.DB.prepare(`SELECT id, guest_name, deposit_amount FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE bookings SET deposit_amount = ? WHERE id = ?`).bind(depositAmount, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('deposit_change', 'booking', ?, ?, ?, ?, ?, ?)`
    ).bind(booking.id, booking.guest_name, String(booking.deposit_amount), String(depositAmount), auth.username, now),
  ]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
