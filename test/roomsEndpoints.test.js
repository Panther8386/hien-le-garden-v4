import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listRooms } from '../functions/api/rooms/index.js';
import { onRequestPost as cleanRoom } from '../functions/api/rooms/[id]/clean.js';
import { onRequestPatch as reorderRooms } from '../functions/api/rooms/reorder.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'admin_a', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (4, 'observer_a', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);
  adminToken = await createSession(env.DB, 3);
  observerToken = await createSession(env.DB, 4);
});

function authedRequest(url, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${managerToken}` } });
}

function authedBody(url, token, method, body) {
  return new Request(url, {
    method,
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/rooms', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listRooms({ request: new Request('https://x/api/rooms'), env });
    expect(response.status).toBe(401);
  });

  it('returns all 16 active rooms as empty by default', async () => {
    const response = await listRooms({ request: authedRequest('https://x/api/rooms'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(16);
    expect(body.every((r) => r.status === 'empty')).toBe(true);
  });

  it('marks a room occupied when it has a checked_in booking', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', ?, '2026-01-01', '2026-01-03', 'checked_in', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const response = await listRooms({ request: authedRequest('https://x/api/rooms'), env });
    const body = await response.json();
    expect(body.find((r) => r.id === room.id).status).toBe('occupied');
  });

  it('marks a room needing cleaning even over an occupied booking', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(room.id).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'vip', ?, '2026-01-01', '2026-01-03', 'checked_in', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const response = await listRooms({ request: authedRequest('https://x/api/rooms'), env });
    const body = await response.json();
    expect(body.find((r) => r.id === room.id).status).toBe('needs_cleaning');
  });

  it('lets an observer view rooms', async () => {
    const request = new Request('https://x/api/rooms', { headers: { Cookie: `session=${observerToken}` } });
    const response = await listRooms({ request, env });
    expect(response.status).toBe(200);
  });

  it('returns the date-scoped 5-state model when ?date= is passed', async () => {
    const rooms = await env.DB.prepare(`SELECT id, room_type FROM rooms WHERE is_active = 1 ORDER BY id`).all().then((r) => r.results);
    const [emptyRoom, bookedRoom, depositedRoom, occupiedRoom, usedRoom] = rooms;

    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, deposit_amount, created_at)
       VALUES ('B', '090', ?, ?, '2026-09-10', '2026-09-12', 'pending', 'website', 0, '2026-08-27T00:00:00Z')`
    ).bind(bookedRoom.room_type, bookedRoom.id).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, deposit_amount, created_at)
       VALUES ('C', '090', ?, ?, '2026-09-10', '2026-09-12', 'confirmed', 'website', 200000, '2026-08-27T00:00:00Z')`
    ).bind(depositedRoom.room_type, depositedRoom.id).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('D', '090', ?, ?, '2026-09-10', '2026-09-12', 'checked_in', 'website', '2026-08-27T00:00:00Z')`
    ).bind(occupiedRoom.room_type, occupiedRoom.id).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('E', '090', ?, ?, '2026-09-10', '2026-09-12', 'checked_out', 'website', '2026-08-27T00:00:00Z')`
    ).bind(usedRoom.room_type, usedRoom.id).run();
    // A cancelled booking overlapping the date must not affect the room's status.
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('F', '090', ?, ?, '2026-09-10', '2026-09-12', 'cancelled', 'website', '2026-08-27T00:00:00Z')`
    ).bind(emptyRoom.room_type, emptyRoom.id).run();

    const response = await listRooms({ request: authedRequest('https://x/api/rooms?date=2026-09-11'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    const byId = Object.fromEntries(body.map((r) => [r.id, r]));
    expect(byId[emptyRoom.id].status).toBe('empty');
    expect(byId[bookedRoom.id].status).toBe('booked');
    expect(byId[depositedRoom.id].status).toBe('booked_deposited');
    expect(byId[occupiedRoom.id].status).toBe('occupied');
    expect(byId[usedRoom.id].status).toBe('used');
  });

  it('does not include a booking whose date range does not cover the queried date', async () => {
    const room = await env.DB.prepare(`SELECT id, room_type FROM rooms WHERE is_active = 1 LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('G', '090', ?, ?, '2026-09-10', '2026-09-12', 'confirmed', 'website', '2026-08-27T00:00:00Z')`
    ).bind(room.room_type, room.id).run();

    const response = await listRooms({ request: authedRequest('https://x/api/rooms?date=2026-09-20'), env });
    const body = await response.json();
    expect(body.find((r) => r.id === room.id).status).toBe('empty');
  });
});

describe('POST /api/rooms/:id/clean', () => {
  it('clears the needs_cleaning flag', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'bungalow' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(room.id).run();

    const response = await cleanRoom({ request: authedRequest(`https://x/api/rooms/${room.id}/clean`, 'POST'), env, params: { id: String(room.id) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT needs_cleaning FROM rooms WHERE id = ?`).bind(room.id).first();
    expect(row.needs_cleaning).toBe(0);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await cleanRoom({ request: new Request('https://x/api/rooms/1/clean', { method: 'POST' }), env, params: { id: '1' } });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent room', async () => {
    const response = await cleanRoom({ request: authedRequest('https://x/api/rooms/999999/clean', 'POST'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/rooms/reorder', () => {
  it('lets a manager save a new display order, reflected by GET /api/rooms', async () => {
    const { results: rooms } = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 ORDER BY display_order, id`).all();
    const ids = rooms.map((r) => r.id);
    const reversed = [...ids].reverse();

    const response = await reorderRooms({ request: authedBody('https://x/api/rooms/reorder', managerToken, 'PATCH', { order: reversed }), env });
    expect(response.status).toBe(200);

    const listResponse = await listRooms({ request: authedRequest('https://x/api/rooms'), env });
    const body = await listResponse.json();
    expect(body.map((r) => r.id)).toEqual(reversed);
  });

  it('lets an admin reorder rooms', async () => {
    const results = await listRooms({ request: authedRequest('https://x/api/rooms'), env }).then((r) => r.json());
    const ids = results.map((r) => r.id).reverse();
    const request = authedBody('https://x/api/rooms/reorder', adminToken, 'PATCH', { order: ids });
    const response = await reorderRooms({ request, env, params: {} });
    expect(response.status).toBe(200);
  });

  it('rejects a reception account (403)', async () => {
    const { results: rooms } = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 ORDER BY display_order, id`).all();
    const response = await reorderRooms({ request: authedBody('https://x/api/rooms/reorder', receptionToken, 'PATCH', { order: rooms.map((r) => r.id) }), env });
    expect(response.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await reorderRooms({ request: new Request('https://x/api/rooms/reorder', { method: 'PATCH' }), env });
    expect(response.status).toBe(401);
  });

  it('rejects an order missing a room (400)', async () => {
    const { results: rooms } = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 ORDER BY display_order, id`).all();
    const incomplete = rooms.slice(1).map((r) => r.id);
    const response = await reorderRooms({ request: authedBody('https://x/api/rooms/reorder', managerToken, 'PATCH', { order: incomplete }), env });
    expect(response.status).toBe(400);
  });

  it('rejects an order with a duplicate id (400)', async () => {
    const { results: rooms } = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 ORDER BY display_order, id`).all();
    const ids = rooms.map((r) => r.id);
    const withDuplicate = [...ids.slice(1), ids[0], ids[0]];
    const response = await reorderRooms({ request: authedBody('https://x/api/rooms/reorder', managerToken, 'PATCH', { order: withDuplicate }), env });
    expect(response.status).toBe(400);
  });

  it('rejects an order containing an unknown room id (400)', async () => {
    const { results: rooms } = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 ORDER BY display_order, id`).all();
    const ids = rooms.map((r) => r.id);
    const withUnknown = [...ids.slice(1), 999999];
    const response = await reorderRooms({ request: authedBody('https://x/api/rooms/reorder', managerToken, 'PATCH', { order: withUnknown }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a non-array order (400)', async () => {
    const response = await reorderRooms({ request: authedBody('https://x/api/rooms/reorder', managerToken, 'PATCH', { order: 'not-an-array' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/rooms/reorder', {
      method: 'PATCH',
      headers: { Cookie: `session=${managerToken}`, 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const response = await reorderRooms({ request, env });
    expect(response.status).toBe(400);
  });
});
