import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasRoomConflict } from '../../../../lib/bookingAvailability.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};
  const { roomId } = body;
  if (!Number.isInteger(roomId)) {
    return jsonError('Vui lòng chọn phòng cụ thể', 400);
  }

  const booking = await env.DB.prepare(`SELECT id, room_type, check_in, check_out, status FROM bookings WHERE id = ?`).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy yêu cầu đặt phòng', 404);
  }
  if (booking.status !== 'pending') {
    return jsonError('Yêu cầu này không còn ở trạng thái chờ xử lý', 400);
  }

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ? AND room_type = ? AND is_active = 1`).bind(roomId, booking.room_type).first();
  if (!room) {
    return jsonError('Phòng không tồn tại hoặc không thuộc loại đã yêu cầu', 400);
  }

  const conflict = await hasRoomConflict(env, roomId, booking.check_in, booking.check_out);
  if (conflict) {
    return jsonError('Phòng đã được đặt trong khoảng ngày này', 409);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE bookings SET status = 'confirmed', room_id = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?`
  ).bind(roomId, auth.username, now, params.id).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
