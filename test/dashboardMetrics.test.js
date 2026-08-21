import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getTodaySnapshot } from '../lib/dashboardMetrics.js';

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
