export async function getAvailability(env, roomType, checkIn, checkOut) {
  const { results: allRooms } = await env.DB.prepare(
    `SELECT id, name FROM rooms WHERE room_type = ? AND is_active = 1 ORDER BY name`
  ).bind(roomType).all();

  const { results: bookedRows } = await env.DB.prepare(
    `SELECT DISTINCT room_id FROM bookings
     WHERE room_type = ? AND room_id IS NOT NULL AND status IN ('confirmed', 'checked_in')
       AND check_in < ? AND check_out > ?`
  ).bind(roomType, checkOut, checkIn).all();

  const bookedIds = new Set(bookedRows.map((r) => r.room_id));
  const availableRooms = allRooms.filter((r) => !bookedIds.has(r.id));

  return {
    roomType,
    totalRooms: allRooms.length,
    bookedCount: bookedIds.size,
    available: availableRooms.length,
    availableRooms: availableRooms.map((r) => ({ id: r.id, name: r.name })),
  };
}

export async function hasRoomConflict(env, roomId, checkIn, checkOut) {
  const row = await env.DB.prepare(
    `SELECT id FROM bookings
     WHERE room_id = ? AND status IN ('confirmed', 'checked_in')
       AND check_in < ? AND check_out > ?
     LIMIT 1`
  ).bind(roomId, checkOut, checkIn).first();
  return !!row;
}
