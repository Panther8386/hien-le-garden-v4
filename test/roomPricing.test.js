import { describe, it, expect } from 'vitest';
import { priceForNight, computeRoomTotal } from '../lib/roomPricing.js';

const configuredRoom = { roomType: 'vip', priceWeekday: 700000, priceWeekend: 900000 };
const unconfiguredRoom = { roomType: 'vip', priceWeekday: null, priceWeekend: null };
const noHolidays = [];

describe('priceForNight', () => {
  it('uses the configured weekday price for a Monday–Thursday date', () => {
    // 2026-09-08 is a Tuesday
    expect(priceForNight('2026-09-08', configuredRoom, noHolidays)).toBe(700000);
  });

  it('uses the configured weekend price for a Friday–Sunday date', () => {
    // 2026-09-11 is a Friday
    expect(priceForNight('2026-09-11', configuredRoom, noHolidays)).toBe(900000);
    // 2026-09-13 is a Sunday
    expect(priceForNight('2026-09-13', configuredRoom, noHolidays)).toBe(900000);
  });

  it('falls back to ROOM_TYPES flat price when the room has no configured price for that tier', () => {
    // 2026-09-08 is a Tuesday (weekday tier); vip flat rate is 900000
    expect(priceForNight('2026-09-08', unconfiguredRoom, noHolidays)).toBe(900000);
    // 2026-09-11 is a Friday (weekend tier); vip flat rate is still 900000
    expect(priceForNight('2026-09-11', unconfiguredRoom, noHolidays)).toBe(900000);
  });

  it('falls back only for the tier that is null, using the configured value for the other tier', () => {
    const partiallyConfigured = { roomType: 'vip', priceWeekday: 700000, priceWeekend: null };
    // 2026-09-08 is a Tuesday (weekday tier) — uses the configured 700000
    expect(priceForNight('2026-09-08', partiallyConfigured, noHolidays)).toBe(700000);
    // 2026-09-11 is a Friday (weekend tier) — priceWeekend is null, falls back to vip's flat rate 900000
    expect(priceForNight('2026-09-11', partiallyConfigured, noHolidays)).toBe(900000);
  });

  it('bills a holiday date at the weekend rate even when it falls on a weekday', () => {
    // 2026-09-08 is a Tuesday; put it inside a holiday range
    const holidays = [{ startDate: '2026-09-07', endDate: '2026-09-09' }];
    expect(priceForNight('2026-09-08', configuredRoom, holidays)).toBe(900000);
  });

  it('does not apply the holiday rate to a date outside every holiday range', () => {
    const holidays = [{ startDate: '2026-09-01', endDate: '2026-09-02' }];
    expect(priceForNight('2026-09-08', configuredRoom, holidays)).toBe(700000);
  });
});

describe('computeRoomTotal', () => {
  it('sums a stay that only spans weekday nights', () => {
    // Mon 2026-09-07 check-in .. Fri 2026-09-11 check-out = 4 nights, all Mon–Thu
    expect(computeRoomTotal('2026-09-07', '2026-09-11', configuredRoom, noHolidays)).toBe(4 * 700000);
  });

  it('sums a stay that only spans weekend nights', () => {
    // Fri 2026-09-11 check-in .. Mon 2026-09-14 check-out = 3 nights, Fri/Sat/Sun
    expect(computeRoomTotal('2026-09-11', '2026-09-14', configuredRoom, noHolidays)).toBe(3 * 900000);
  });

  it('sums a stay crossing from weekday into weekend nights at each night\'s own rate', () => {
    // Thu 2026-09-10 check-in .. Sat 2026-09-12 check-out = 2 nights: Thu (weekday), Fri (weekend)
    expect(computeRoomTotal('2026-09-10', '2026-09-12', configuredRoom, noHolidays)).toBe(700000 + 900000);
  });

  it('bills a holiday night inside an otherwise-weekday stay at the weekend rate', () => {
    // Mon 2026-09-07 .. Thu 2026-09-10 = 3 nights: Mon, Tue, Wed; Tue is a holiday
    const holidays = [{ startDate: '2026-09-08', endDate: '2026-09-08' }];
    expect(computeRoomTotal('2026-09-07', '2026-09-10', configuredRoom, holidays)).toBe(700000 + 900000 + 700000);
  });

  it('sums a 1-night stay as exactly one night', () => {
    expect(computeRoomTotal('2026-09-07', '2026-09-08', configuredRoom, noHolidays)).toBe(700000);
  });

  it('returns 0 for a 0-night range', () => {
    expect(computeRoomTotal('2026-09-07', '2026-09-07', configuredRoom, noHolidays)).toBe(0);
  });
});
