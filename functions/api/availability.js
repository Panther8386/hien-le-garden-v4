import { getAvailability } from '../../lib/bookingAvailability.js';
import { ROOM_TYPES } from '../../lib/roomTypes.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_ROOM_TYPES = Object.keys(ROOM_TYPES);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const roomType = url.searchParams.get('roomType');
  const checkIn = url.searchParams.get('checkIn');
  const checkOut = url.searchParams.get('checkOut');

  if (!VALID_ROOM_TYPES.includes(roomType)) {
    return jsonError('Loại phòng không hợp lệ', 400);
  }
  if (!checkIn || !checkOut || isNaN(Date.parse(checkIn)) || isNaN(Date.parse(checkOut))) {
    return jsonError('Ngày không hợp lệ', 400);
  }
  if (checkOut <= checkIn) {
    return jsonError('Ngày trả phòng phải sau ngày nhận phòng', 400);
  }

  const availability = await getAvailability(env, roomType, checkIn, checkOut);
  return new Response(JSON.stringify(availability), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
