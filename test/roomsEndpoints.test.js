import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listRooms } from '../functions/api/rooms/index.js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
});

function authedRequest(url, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${managerToken}` } });
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
});
