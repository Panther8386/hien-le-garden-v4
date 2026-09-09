import { ROOM_TYPES } from './roomTypes.js';

function isWeekendDow(dateStr) {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 5 || dow === 6; // Sun, Fri, Sat
}

function isHolidayDate(dateStr, holidays) {
  return holidays.some((h) => dateStr >= h.startDate && dateStr <= h.endDate);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function priceForNight(dateStr, room, holidays) {
  const isWeekend = isWeekendDow(dateStr) || isHolidayDate(dateStr, holidays);
  const fallback = ROOM_TYPES[room.roomType].priceVnd;
  const configured = isWeekend ? room.priceWeekend : room.priceWeekday;
  return configured != null ? configured : fallback;
}

export function computeRoomTotal(startDate, endDate, room, holidays) {
  let total = 0;
  let d = startDate;
  while (d < endDate) {
    total += priceForNight(d, room, holidays);
    d = addDays(d, 1);
  }
  return total;
}
