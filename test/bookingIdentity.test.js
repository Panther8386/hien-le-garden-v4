import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getBooking } from '../functions/api/bookings/[id]/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_id', 'x', 'manager', '2026-09-04T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_id', 'x', 'reception', '2026-09-04T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_id', 'x', 'observer', '2026-09-04T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/bookings/:id', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getBooking({ request: new Request('https://x/api/bookings/1'), env, params: { id: '1' } });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await getBooking({ request: authedRequest('https://x/api/bookings/1', observerToken, 'GET'), env, params: { id: '1' } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await getBooking({ request: authedRequest('https://x/api/bookings/999999', receptionToken, 'GET'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('returns full booking detail including the joined room name', async () => {
    const room = await env.DB.prepare(`SELECT id, name FROM rooms WHERE room_type = 'triangle' LIMIT 1`).first();
    const created = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, guests_count, status, source, created_at)
       VALUES ('Nguyễn Văn A', '0900000001', 'triangle', ?, '2026-09-10', '2026-09-12', 2, 'checked_in', 'website', '2026-09-04T00:00:00Z')`
    ).bind(room.id).run();
    const id = created.meta.last_row_id;

    const response = await getBooking({ request: authedRequest(`https://x/api/bookings/${id}`, managerToken, 'GET'), env, params: { id: String(id) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id, guestName: 'Nguyễn Văn A', phone: '0900000001', roomType: 'triangle',
      roomId: room.id, roomName: room.name, checkIn: '2026-09-10', checkOut: '2026-09-12',
      guestsCount: 2, status: 'checked_in', idNumber: null, nationality: null,
    });
  });
});
