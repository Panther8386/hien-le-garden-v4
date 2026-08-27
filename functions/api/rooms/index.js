import { requireAuth } from '../../../lib/requireAuth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const date = url.searchParams.get('date');

  const { results: rooms } = await env.DB.prepare(
    `SELECT id, name, room_type AS roomType, needs_cleaning AS needsCleaning FROM rooms WHERE is_active = 1 ORDER BY display_order, id`
  ).all();

  if (!date) {
    const { results: occupiedRows } = await env.DB.prepare(
      `SELECT DISTINCT room_id FROM bookings WHERE status = 'checked_in' AND room_id IS NOT NULL`
    ).all();
    const occupiedIds = new Set(occupiedRows.map((r) => r.room_id));

    const mapped = rooms.map((r) => ({
      id: r.id,
      name: r.name,
      roomType: r.roomType,
      status: r.needsCleaning ? 'needs_cleaning' : occupiedIds.has(r.id) ? 'occupied' : 'empty',
    }));

    return new Response(JSON.stringify(mapped), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const { results: overlapping } = await env.DB.prepare(
    `SELECT room_id, status, deposit_amount FROM bookings
     WHERE room_id IS NOT NULL AND status != 'cancelled' AND check_in <= ? AND ? < check_out`
  ).bind(date, date).all();
  const bookingByRoom = new Map(overlapping.map((b) => [b.room_id, b]));

  const mapped = rooms.map((r) => {
    const booking = bookingByRoom.get(r.id);
    let status;
    if (!booking) {
      status = 'empty';
    } else if (booking.status === 'checked_in') {
      status = 'occupied';
    } else if (booking.status === 'checked_out') {
      status = 'used';
    } else if (booking.deposit_amount > 0) {
      status = 'booked_deposited';
    } else {
      status = 'booked';
    }
    return {
      id: r.id,
      name: r.name,
      roomType: r.roomType,
      status,
      needsCleaning: !!r.needsCleaning,
    };
  });

  return new Response(JSON.stringify(mapped), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
