import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as staffCreateBooking } from '../functions/api/bookings/staff.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, circleRoomId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
  circleRoomId = room.id;
});

function authedPost(url, token, body) {
  return new Request(url, { method: 'POST', headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/bookings/staff', () => {
  const validBody = () => ({ guestName: 'Trần Văn B', phone: '0900000002', roomType: 'circle', roomId: circleRoomId, checkIn: '2099-01-01', checkOut: '2099-01-03', source: 'phone' });

  it('lets reception create a confirmed booking directly', async () => {
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', receptionToken, validBody()), env });
    expect(response.status).toBe(201);
    const body = await response.json();

    const row = await env.DB.prepare(`SELECT status, room_id, created_by, confirmed_by FROM bookings WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ status: 'confirmed', room_id: circleRoomId, created_by: 'le_tan_a', confirmed_by: 'le_tan_a' });
  });

  it('rejects unauthenticated requests', async () => {
    const response = await staffCreateBooking({ request: new Request('https://x/api/bookings/staff', { method: 'POST', body: JSON.stringify(validBody()) }), env });
    expect(response.status).toBe(401);
  });

  it('rejects an invalid source', async () => {
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, { ...validBody(), source: 'website' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a missing roomId', async () => {
    const { roomId, ...rest } = validBody();
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, rest), env });
    expect(response.status).toBe(400);
  });

  it('rejects a roomId that does not belong to the given room type', async () => {
    const vipRoom = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'vip' ORDER BY id LIMIT 1`).first();
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, { ...validBody(), roomId: vipRoom.id }), env });
    expect(response.status).toBe(400);
  });

  it('returns 409 when the room is already booked for overlapping dates', async () => {
    await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, validBody()), env });
    const response = await staffCreateBooking({ request: authedPost('https://x/api/bookings/staff', managerToken, { ...validBody(), guestName: 'Someone Else' }), env });
    expect(response.status).toBe(409);
  });
});
