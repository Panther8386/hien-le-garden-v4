import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as confirmBooking } from '../functions/api/bookings/[id]/confirm.js';
import { onRequestPost as rejectBooking } from '../functions/api/bookings/[id]/reject.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, circleRoomId, otherCircleRoomId, pendingBookingId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);

  const rooms = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 2`).all();
  circleRoomId = rooms.results[0].id;
  otherCircleRoomId = rooms.results[1].id;

  const inserted = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
     VALUES ('Nguyễn Văn A', '0900000001', 'circle', '2099-01-01', '2099-01-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
  ).run();
  pendingBookingId = inserted.meta.last_row_id;
});

function authedPost(url, token, body) {
  return new Request(url, {
    method: 'POST',
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/bookings/:id/confirm', () => {
  it('confirms a pending booking and assigns the chosen room', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status, room_id, confirmed_by FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row).toEqual({ status: 'confirmed', room_id: circleRoomId, confirmed_by: 'quan_ly_a' });
  });

  it('lets a reception account confirm too', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, receptionToken, { roomId: circleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await confirmBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/confirm`, { method: 'POST', body: JSON.stringify({ roomId: circleRoomId }) }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await confirmBooking({
      request: authedPost('https://x/api/bookings/999999/confirm', managerToken, { roomId: circleRoomId }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('rejects confirming a booking that is not pending', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }), env, params: { id: String(pendingBookingId) } });
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: otherCircleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 409 when the chosen room already has an overlapping confirmed booking', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('Khác', '090', 'circle', ?, '2099-01-02', '2099-01-04', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(circleRoomId).run();

    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(409);
  });

  it('rejects a missing roomId with 400 instead of crashing', async () => {
    const response = await confirmBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, {}),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/bookings/:id/reject', () => {
  it('cancels a pending booking', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.status).toBe('cancelled');
  });

  it('accepts an optional reason', async () => {
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken, { reason: 'Hết phòng' }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT cancel_reason FROM bookings WHERE id = ?`).bind(pendingBookingId).first();
    expect(row.cancel_reason).toBe('Hết phòng');
  });

  it('works with no request body at all', async () => {
    const response = await rejectBooking({
      request: new Request(`https://x/api/bookings/${pendingBookingId}/reject`, { method: 'POST', headers: { Cookie: `session=${managerToken}` } }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects rejecting a booking that is not pending', async () => {
    await confirmBooking({ request: authedPost(`https://x/api/bookings/${pendingBookingId}/confirm`, managerToken, { roomId: circleRoomId }), env, params: { id: String(pendingBookingId) } });
    const response = await rejectBooking({
      request: authedPost(`https://x/api/bookings/${pendingBookingId}/reject`, managerToken),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const response = await rejectBooking({
      request: authedPost('https://x/api/bookings/999999/reject', managerToken),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });
});
