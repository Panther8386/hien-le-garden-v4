import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasRoomConflict } from '../../../../lib/bookingAvailability.js';
import { ROOM_TYPES } from '../../../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ROOM_TYPES = Object.keys(ROOM_TYPES);

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
  const { rooms } = body;

  if (!Array.isArray(rooms) || rooms.length === 0) {
    return jsonError('Vui lòng chọn ít nhất một phòng', 400);
  }
  const allValidShape = rooms.every(
    (r) => r && VALID_ROOM_TYPES.includes(r.roomType) && Number.isInteger(r.roomId)
  );
  if (!allValidShape) {
    return jsonError('Danh sách phòng không hợp lệ', 400);
  }
  const roomIds = rooms.map((r) => r.roomId);
  if (new Set(roomIds).size !== roomIds.length) {
    return jsonError('Danh sách phòng có phòng trùng lặp', 400);
  }

  const booking = await env.DB.prepare(
    `SELECT id, guest_name, phone, email, check_in, check_out, guests_count, notes, source, status FROM bookings WHERE id = ?`
  ).bind(params.id).first();
  if (!booking) {
    return jsonError('Không tìm thấy yêu cầu đặt phòng', 404);
  }
  if (booking.status !== 'pending') {
    return jsonError('Yêu cầu này không còn ở trạng thái chờ xử lý', 400);
  }

  for (const r of rooms) {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ? AND room_type = ? AND is_active = 1`)
      .bind(r.roomId, r.roomType)
      .first();
    if (!room) {
      return jsonError('Một trong các phòng đã chọn không tồn tại hoặc không thuộc loại đã chọn', 400);
    }
    const conflict = await hasRoomConflict(env, r.roomId, booking.check_in, booking.check_out);
    if (conflict) {
      return jsonError('Một trong các phòng đã chọn đã được đặt trong khoảng ngày này', 409);
    }
  }

  const now = new Date().toISOString();
  const [firstRoom, ...extraRooms] = rooms;

  const statements = [
    env.DB.prepare(
      `UPDATE bookings SET status = 'confirmed', room_type = ?, room_id = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?`
    ).bind(firstRoom.roomType, firstRoom.roomId, auth.username, now, params.id),
  ];

  for (const r of extraRooms) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO bookings (guest_name, phone, email, room_type, room_id, check_in, check_out, guests_count, notes, status, source, created_at, confirmed_by, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`
      ).bind(
        booking.guest_name,
        booking.phone,
        booking.email,
        r.roomType,
        r.roomId,
        booking.check_in,
        booking.check_out,
        booking.guests_count,
        booking.notes,
        booking.source,
        now,
        auth.username,
        now
      )
    );
  }

  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
