import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getTodaySnapshot, getMonthSummary } from '../lib/dashboardMetrics.js';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');
});

describe('getTodaySnapshot', () => {
  it('counts all 16 active rooms as empty with no bookings', async () => {
    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.roomsOccupied).toBe(0);
    expect(snapshot.roomsNeedCleaning).toBe(0);
    expect(snapshot.roomsEmpty).toBe(16);
    expect(snapshot.arrivalsToday).toBe(0);
    expect(snapshot.departuresToday).toBe(0);
  });

  it('counts a checked_in room as occupied', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2020-01-01', '2020-01-03', 'checked_in', 'website', '2020-01-01T00:00:00Z')`
    ).bind(room.id).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.roomsOccupied).toBe(1);
    expect(snapshot.roomsEmpty).toBe(15);
  });

  it('needs_cleaning wins over occupied for the same room', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(room.id).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2020-01-01', '2020-01-03', 'checked_in', 'website', '2020-01-01T00:00:00Z')`
    ).bind(room.id).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.roomsNeedCleaning).toBe(1);
    expect(snapshot.roomsOccupied).toBe(0);
  });

  it('counts a confirmed booking checking in today as an arrival', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2099-01-01', 'confirmed', 'website', '2020-01-01T00:00:00Z')`
    ).bind(today).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.arrivalsToday).toBe(1);
  });

  it('counts an overdue checked_in booking (check_out before today) as a departure', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2020-01-01', ?, 'checked_in', 'website', '2020-01-01T00:00:00Z')`
    ).bind(yesterday).run();

    const snapshot = await getTodaySnapshot(env);
    expect(snapshot.departuresToday).toBe(1);
  });
});

describe('getMonthSummary', () => {
  it('returns zeros for a month with no bookings', async () => {
    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.occupancyRate).toBe(0);
    expect(summary.roomRevenueVnd).toBe(0);
    expect(summary.serviceRevenueVnd).toBe(0);
    expect(summary.totalRevenueVnd).toBe(0);
    expect(summary.adrVnd).toBe(0);
    expect(summary.statusFunnel).toEqual({ pending: 0, confirmed: 0, checked_in: 0, checked_out: 0, cancelled: 0 });
    expect(summary.sourceBreakdown).toEqual({ website: 0, phone: 0, zalo: 0, walk_in: 0 });
  });

  it('splits a cross-month booking\'s nights correctly between the two months it overlaps', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-07-30', '2026-08-02', 'confirmed', 'website', '2026-07-01T00:00:00Z')`
    ).run();

    const july = await getMonthSummary(env, '2026-07');
    const august = await getMonthSummary(env, '2026-08');

    // circle = 600000 VND/night; stay is Jul30,Jul31,Aug1 = 3 nights total, split 2/1
    expect(july.roomRevenueVnd).toBe(2 * 600000);
    expect(august.roomRevenueVnd).toBe(1 * 600000);
    expect(july.statusFunnel.confirmed).toBe(1);
    expect(august.statusFunnel.confirmed).toBe(1);
  });

  it('excludes pending and cancelled bookings from occupancy and revenue but counts them in the status funnel', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-05', '2026-08-07', 'pending', 'website', '2026-08-01T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('B', '091', 'vip', '2026-08-05', '2026-08-07', 'cancelled', 'phone', '2026-08-01T00:00:00Z')`
    ).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.occupancyRate).toBe(0);
    expect(summary.roomRevenueVnd).toBe(0);
    expect(summary.statusFunnel.pending).toBe(1);
    expect(summary.statusFunnel.cancelled).toBe(1);
  });

  it('excludes cancelled bookings from source breakdown', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-05', '2026-08-07', 'cancelled', 'zalo', '2026-08-01T00:00:00Z')`
    ).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.sourceBreakdown.zalo).toBe(0);
  });

  it('computes occupancy rate as booked room-nights over active-room-nights for the month', async () => {
    // August 2026 has 31 days, 16 active rooms => 496 room-nights capacity; this booking is 10 nights
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-01', '2026-08-11', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.occupancyRate).toBeCloseTo(10 / (16 * 31), 5);
  });

  it('computes ADR as room revenue over occupied nights', async () => {
    // circle = 600000 VND/night, 10 occupied nights => ADR is just the flat rate here,
    // but ADR is computed as roomRevenueVnd / occupiedNights, not read from ROOM_TYPES directly
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-01', '2026-08-11', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.adrVnd).toBe(600000);
  });

  it('returns an ADR of 0 when there are no occupied nights (avoids divide-by-zero)', async () => {
    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.adrVnd).toBe(0);
  });

  it('sums posted service revenue within the month, excluding voided items', async () => {
    const booking = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-01', '2026-08-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).run();
    const bookingId = booking.meta.last_row_id;

    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at)
       VALUES (?, 'Cà phê', 30000, 2, 60000, 'posted', 'le_tan', '2026-08-05T00:00:00Z')`
    ).bind(bookingId).run();
    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at)
       VALUES (?, 'BBQ', 200000, 1, 200000, 'voided', 'le_tan', '2026-08-06T00:00:00Z')`
    ).bind(bookingId).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.serviceRevenueVnd).toBe(60000);
  });

  it('excludes service items added outside the queried month', async () => {
    const booking = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-01', '2026-08-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).run();
    const bookingId = booking.meta.last_row_id;

    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at)
       VALUES (?, 'Cà phê', 30000, 1, 30000, 'posted', 'le_tan', '2026-09-01T00:00:00Z')`
    ).bind(bookingId).run();

    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.serviceRevenueVnd).toBe(0);
  });

  it('computes totalRevenueVnd as room revenue plus service revenue', async () => {
    const booking = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-08-01', '2026-08-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).run();
    const bookingId = booking.meta.last_row_id;
    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at)
       VALUES (?, 'Cà phê', 30000, 2, 60000, 'posted', 'le_tan', '2026-08-05T00:00:00Z')`
    ).bind(bookingId).run();

    // circle = 600000 VND/night, 2 nights => 1,200,000 room revenue + 60,000 service revenue
    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.roomRevenueVnd).toBe(1200000);
    expect(summary.serviceRevenueVnd).toBe(60000);
    expect(summary.totalRevenueVnd).toBe(1260000);
  });

  it('counts the full month of nights for a booking that starts before and ends after the queried month', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'triangle', '2026-07-15', '2026-09-15', 'confirmed', 'website', '2026-07-01T00:00:00Z')`
    ).run();

    // triangle = 300000 VND/night; August 2026 has 31 days, all of which fall inside the stay
    const summary = await getMonthSummary(env, '2026-08');
    expect(summary.roomRevenueVnd).toBe(31 * 300000);
    expect(summary.occupancyRate).toBeCloseTo(31 / (16 * 31), 5);
  });

  it('correctly rolls over the month boundary from December to January', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-12-20', '2027-01-05', 'confirmed', 'website', '2026-12-01T00:00:00Z')`
    ).run();

    // circle = 600000 VND/night; December's share is Dec20..Dec31 = 12 nights
    const december = await getMonthSummary(env, '2026-12');
    expect(december.roomRevenueVnd).toBe(12 * 600000);

    // January's share is Jan1..Jan5 = 4 nights
    const january = await getMonthSummary(env, '2027-01');
    expect(january.roomRevenueVnd).toBe(4 * 600000);
  });
});
