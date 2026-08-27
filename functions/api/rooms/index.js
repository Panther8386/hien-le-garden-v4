import { requireAuth } from '../../../lib/requireAuth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const { results: rooms } = await env.DB.prepare(
    `SELECT id, name, room_type AS roomType, needs_cleaning AS needsCleaning FROM rooms WHERE is_active = 1 ORDER BY display_order, id`
  ).all();

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
