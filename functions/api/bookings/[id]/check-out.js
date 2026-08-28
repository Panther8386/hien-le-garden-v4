import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(`SELECT id, status, room_id FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'checked_in') {
    return jsonError('Chỉ có thể check-out từ trạng thái đang lưu trú', 400);
  }

  const statements = [
    env.DB.prepare(`UPDATE bookings SET status = 'checked_out' WHERE id = ?`).bind(params.id),
  ];
  if (booking.room_id) {
    statements.push(env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = ? WHERE id = ?`).bind(new Date().toISOString(), booking.room_id));
  }
  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
