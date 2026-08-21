import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getAvailability, hasRoomConflict } from '../lib/bookingAvailability.js';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bookings');
});

describe('getAvailability', () => {
  it('returns all 5 Circle House rooms available when there are no bookings', async () => {
    const result = await getAvailability(env, 'circle', '2026-09-01', '2026-09-03');
    expect(result.totalRooms).toBe(5);
    expect(result.available).toBe(5);
    expect(result.bookedCount).toBe(0);
    expect(result.availableRooms).toHaveLength(5);
  });

  it('excludes a room booked with an overlapping confirmed stay', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-09-01', '2026-09-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const result = await getAvailability(env, 'circle', '2026-09-01', '2026-09-03');
    expect(result.available).toBe(4);
    expect(result.availableRooms.find((r) => r.id === room.id)).toBeUndefined();
  });

  it('does not count a pending request against availability', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-09-01', '2026-09-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const result = await getAvailability(env, 'circle', '2026-09-01', '2026-09-03');
    expect(result.available).toBe(5);
  });

  it('treats back-to-back stays (checkout day = next checkin day) as non-overlapping', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-09-01', '2026-09-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const result = await getAvailability(env, 'circle', '2026-09-03', '2026-09-05');
    expect(result.available).toBe(5);
  });
});

describe('hasRoomConflict', () => {
  it('returns false when the room has no bookings', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    expect(await hasRoomConflict(env, room.id, '2026-09-01', '2026-09-03')).toBe(false);
  });

  it('returns true when the exact same room overlaps a confirmed booking', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2026-09-01', '2026-09-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    expect(await hasRoomConflict(env, room.id, '2026-09-02', '2026-09-04')).toBe(true);
  });

  it('returns false for a checked_out booking on the same room and dates', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2026-09-01', '2026-09-03', 'checked_out', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    expect(await hasRoomConflict(env, room.id, '2026-09-01', '2026-09-03')).toBe(false);
  });
});
