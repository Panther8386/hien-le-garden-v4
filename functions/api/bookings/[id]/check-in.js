import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const booking = await env.DB.prepare(`SELECT id, status FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy đặt phòng', 404);
  }
  if (booking.status !== 'confirmed') {
    return jsonError('Chỉ có thể check-in từ trạng thái đã xác nhận', 400);
  }

  await env.DB.prepare(`UPDATE bookings SET status = 'checked_in' WHERE id = ?`).bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
