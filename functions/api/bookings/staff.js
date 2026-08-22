import { requireAuth } from '../../../lib/requireAuth.js';
import { hasRoomConflict } from '../../../lib/bookingAvailability.js';
import { ROOM_TYPES } from '../../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ROOM_TYPES = Object.keys(ROOM_TYPES);
const VALID_SOURCES = ['phone', 'zalo', 'walk_in'];
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};

  const { guestName, phone, email, roomType, roomId, checkIn, checkOut, guestsCount, notes, source } = body;

  if (typeof guestName !== 'string' || guestName.trim().length === 0) {
    return jsonError('Vui lòng nhập họ tên', 400);
  }
  if (guestName.length > 200) {
    return jsonError('Tên khách quá dài', 400);
  }
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    return jsonError('Vui lòng nhập số điện thoại', 400);
  }
  if (phone.length > 200) {
    return jsonError('Số điện thoại quá dài', 400);
  }
  if (email !== undefined && email !== null && (typeof email !== 'string' || !EMAIL_FORMAT.test(email))) {
    return jsonError('Email không hợp lệ', 400);
  }
  if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
    return jsonError('Ghi chú không hợp lệ', 400);
  }
  if (guestsCount !== undefined && guestsCount !== null && (!Number.isInteger(guestsCount) || guestsCount < 1)) {
    return jsonError('Số khách không hợp lệ', 400);
  }
  if (!VALID_ROOM_TYPES.includes(roomType)) {
    return jsonError('Loại phòng không hợp lệ', 400);
  }
  if (!VALID_SOURCES.includes(source)) {
    return jsonError('Nguồn đặt phòng không hợp lệ', 400);
  }
  if (!Number.isInteger(roomId)) {
    return jsonError('Vui lòng chọn phòng cụ thể', 400);
  }
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string' || !DATE_FORMAT.test(checkIn) || !DATE_FORMAT.test(checkOut) || isNaN(Date.parse(checkIn)) || isNaN(Date.parse(checkOut))) {
    return jsonError('Ngày không hợp lệ', 400);
  }
  if (checkOut <= checkIn) {
    return jsonError('Ngày trả phòng phải sau ngày nhận phòng', 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (checkIn < today) {
    return jsonError('Ngày nhận phòng không thể ở quá khứ', 400);
  }

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ? AND room_type = ? AND is_active = 1`).bind(roomId, roomType).first();
  if (!room) {
    return jsonError('Phòng không tồn tại hoặc không thuộc loại đã chọn', 400);
  }

  const conflict = await hasRoomConflict(env, roomId, checkIn, checkOut);
  if (conflict) {
    return jsonError('Phòng đã được đặt trong khoảng ngày này', 409);
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, email, room_type, room_id, check_in, check_out, guests_count, notes, status, source, created_at, created_by, confirmed_by, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)`
  )
    .bind(guestName.trim(), phone.trim(), email || null, roomType, roomId, checkIn, checkOut, guestsCount || null, notes || null, source, now, auth.username, auth.username, now)
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
