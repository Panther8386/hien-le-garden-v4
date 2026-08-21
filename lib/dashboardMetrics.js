export async function getTodaySnapshot(env) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

  const { results: rooms } = await env.DB.prepare(
    `SELECT id, needs_cleaning AS needsCleaning FROM rooms WHERE is_active = 1`
  ).all();

  const { results: checkedInRows } = await env.DB.prepare(
    `SELECT DISTINCT room_id FROM bookings WHERE status = 'checked_in' AND room_id IS NOT NULL`
  ).all();
  const checkedInIds = new Set(checkedInRows.map((r) => r.room_id));

  let roomsOccupied = 0;
  let roomsNeedCleaning = 0;
  let roomsEmpty = 0;
  for (const room of rooms) {
    if (room.needsCleaning) {
      roomsNeedCleaning++;
    } else if (checkedInIds.has(room.id)) {
      roomsOccupied++;
    } else {
      roomsEmpty++;
    }
  }

  const arrivalsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed' AND check_in = ?`
  ).bind(today).first();

  const departuresRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM bookings WHERE status = 'checked_in' AND check_out <= ?`
  ).bind(today).first();

  return {
    roomsOccupied,
    roomsNeedCleaning,
    roomsEmpty,
    arrivalsToday: arrivalsRow.c,
    departuresToday: departuresRow.c,
  };
}
