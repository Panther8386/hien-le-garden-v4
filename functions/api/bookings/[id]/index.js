import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT b.id, b.guest_name AS guestName, b.phone, b.email, b.room_type AS roomType, b.room_id AS roomId,
            r.name AS roomName, b.check_in AS checkIn, b.check_out AS checkOut, b.guests_count AS guestsCount,
            b.notes, b.status, b.id_number AS idNumber, b.nationality
     FROM bookings b LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.id = ?`
  ).bind(params.id).first();

  if (!row) return jsonError('Không tìm thấy đặt phòng', 404);

  return new Response(JSON.stringify(row), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
