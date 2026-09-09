import { computeRoomTotal } from './roomPricing.js';

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

function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const end = `${String(nextYear).padStart(4, '0')}-${String(nextMon).padStart(2, '0')}-01`;
  return { start, end };
}

function nightsInRange(checkIn, checkOut, rangeStart, rangeEnd) {
  const clampedStart = checkIn > rangeStart ? checkIn : rangeStart;
  const clampedEnd = checkOut < rangeEnd ? checkOut : rangeEnd;
  const nights = (Date.parse(clampedEnd) - Date.parse(clampedStart)) / 86400000;
  return { nights: nights > 0 ? nights : 0, clampedStart, clampedEnd };
}

export async function getMonthSummary(env, month) {
  const { start, end } = monthBounds(month);
  const daysInMonth = (Date.parse(end) - Date.parse(start)) / 86400000;

  const activeRoomsRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE is_active = 1`).first();
  const activeRoomsCount = activeRoomsRow.c;

  const { results: overlapping } = await env.DB.prepare(
    `SELECT bk.status, bk.source, bk.room_type AS roomType, bk.check_in AS checkIn, bk.check_out AS checkOut,
            r.price_weekday AS priceWeekday, r.price_weekend AS priceWeekend
     FROM bookings bk LEFT JOIN rooms r ON r.id = bk.room_id
     WHERE bk.check_in < ? AND bk.check_out > ?`
  ).bind(end, start).all();

  const { results: holidayRows } = await env.DB.prepare(
    `SELECT start_date AS startDate, end_date AS endDate FROM holidays`
  ).all();

  const statusFunnel = { pending: 0, confirmed: 0, checked_in: 0, checked_out: 0, cancelled: 0 };
  const sourceBreakdown = { website: 0, phone: 0, zalo: 0, walk_in: 0 };
  let occupiedNights = 0;
  let roomRevenueVnd = 0;

  for (const b of overlapping) {
    statusFunnel[b.status]++;
    if (b.status !== 'cancelled') {
      sourceBreakdown[b.source]++;
    }
    if (b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'checked_out') {
      const { nights, clampedStart, clampedEnd } = nightsInRange(b.checkIn, b.checkOut, start, end);
      occupiedNights += nights;
      roomRevenueVnd += computeRoomTotal(
        clampedStart, clampedEnd,
        { roomType: b.roomType, priceWeekday: b.priceWeekday, priceWeekend: b.priceWeekend },
        holidayRows
      );
    }
  }

  const occupancyRate = activeRoomsCount > 0 ? occupiedNights / (activeRoomsCount * daysInMonth) : 0;
  const adrVnd = occupiedNights > 0 ? roomRevenueVnd / occupiedNights : 0;

  const serviceRevenueRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM booking_service_items WHERE status = 'posted' AND created_at >= ? AND created_at < ?`
  ).bind(start, end).first();
  const serviceRevenueVnd = serviceRevenueRow.total;
  const totalRevenueVnd = roomRevenueVnd + serviceRevenueVnd;

  return { occupancyRate, adrVnd, roomRevenueVnd, serviceRevenueVnd, totalRevenueVnd, statusFunnel, sourceBreakdown };
}
