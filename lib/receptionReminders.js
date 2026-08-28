export async function getReminders(env) {
  const settingsRow = await env.DB.prepare(
    `SELECT pending_deposit_hours AS pendingDepositHours, cleaning_minutes AS cleaningMinutes FROM reminder_settings ORDER BY id DESC LIMIT 1`
  ).first();
  const { pendingDepositHours, cleaningMinutes } = settingsRow || { pendingDepositHours: 2, cleaningMinutes: 60 };

  const now = new Date();
  const depositCutoff = new Date(now.getTime() - pendingDepositHours * 3600000).toISOString();
  const cleaningCutoff = new Date(now.getTime() - cleaningMinutes * 60000).toISOString();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

  const { results: pendingRows } = await env.DB.prepare(
    `SELECT id, guest_name AS guestName, phone, created_at AS createdAt
     FROM bookings
     WHERE status = 'pending' AND deposit_amount = 0 AND created_at < ?
     ORDER BY created_at ASC`
  ).bind(depositCutoff).all();
  const pendingNoDeposit = pendingRows.map((r) => ({
    ...r,
    hoursWaiting: Math.floor((now - Date.parse(r.createdAt)) / 3600000),
  }));

  const { results: arrivingRows } = await env.DB.prepare(
    `SELECT id, guest_name AS guestName, phone, room_type AS roomType, check_in AS checkIn
     FROM bookings
     WHERE status = 'confirmed' AND check_in = ?
     ORDER BY guest_name ASC`
  ).bind(today).all();

  const { results: roomRows } = await env.DB.prepare(
    `SELECT id, name, room_type AS roomType, needs_cleaning_since AS needsCleaningSince
     FROM rooms
     WHERE is_active = 1 AND needs_cleaning = 1 AND needs_cleaning_since IS NOT NULL AND needs_cleaning_since < ?
     ORDER BY needs_cleaning_since ASC`
  ).bind(cleaningCutoff).all();
  const roomsNotCleaned = roomRows.map((r) => ({
    ...r,
    minutesWaiting: Math.floor((now - Date.parse(r.needsCleaningSince)) / 60000),
  }));

  return {
    pendingNoDeposit,
    arrivingToday: arrivingRows,
    roomsNotCleaned,
    thresholds: { pendingDepositHours, cleaningMinutes },
  };
}
