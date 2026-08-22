import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createBooking, onRequestGet as listBookings } from '../functions/api/bookings/index.js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM notification_settings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
});

function postReq(url, body) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function authedRequest(url, token, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${token}` } });
}

describe('POST /api/bookings', () => {
  const validBody = { guestName: 'Nguyễn Văn A', phone: '0900000001', roomType: 'circle', checkIn: '2099-01-01', checkOut: '2099-01-03' };

  it('creates a pending booking request with no auth required', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', validBody), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTypeOf('number');

    const row = await env.DB.prepare(`SELECT status, source, room_id FROM bookings WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ status: 'pending', source: 'website', room_id: null });
  });

  it('does not attempt a Telegram send when no notification chat id is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await createBooking({ request: postReq('https://x/api/bookings', validBody), env: { ...env, TELEGRAM_BOT_TOKEN: 'test-token' } });
    expect(response.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a Telegram notification with the booking details when a chat id is configured', async () => {
    await env.DB.prepare(`INSERT INTO notification_settings (booking_notify_chat_id, updated_at) VALUES ('555', '2026-08-01T00:00:00Z')`).run();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await createBooking({ request: postReq('https://x/api/bookings', validBody), env: { ...env, TELEGRAM_BOT_TOKEN: 'test-token' } });
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    const sentBody = JSON.parse(options.body);
    expect(sentBody.chat_id).toBe('555');
    expect(sentBody.text).toContain('Nguyễn Văn A');
    expect(sentBody.text).toContain('0900000001');
    expect(sentBody.text).toContain('Circle House');
    expect(sentBody.text).toContain('2099-01-01');
    expect(sentBody.text).toContain('2099-01-03');
  });

  it('still creates the booking (201) even if the Telegram send fails', async () => {
    await env.DB.prepare(`INSERT INTO notification_settings (booking_notify_chat_id, updated_at) VALUES ('555', '2026-08-01T00:00:00Z')`).run();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const response = await createBooking({ request: postReq('https://x/api/bookings', validBody), env: { ...env, TELEGRAM_BOT_TOKEN: 'test-token' } });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTypeOf('number');
  });

  it('rejects a missing guest name', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, guestName: '' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a missing phone', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, phone: '' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid room type', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, roomType: 'deluxe' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects checkOut not after checkIn', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, checkIn: '2099-01-03', checkOut: '2099-01-01' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a checkIn date in the past', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, checkIn: '2020-01-01', checkOut: '2020-01-03' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a checkIn with a time component instead of a plain YYYY-MM-DD date', async () => {
    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, checkIn: '2099-01-01T12:00:00Z' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/bookings', { method: 'POST', body: 'not json' });
    const response = await createBooking({ request, env });
    expect(response.status).toBe(400);
  });

  it('rejects a null JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' });
    const response = await createBooking({ request, env });
    expect(response.status).toBe(400);
  });

  it('does not check availability before accepting the request', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'dormitory'`).first();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
       VALUES ('X', '090', 'dormitory', ?, '2099-02-01', '2099-02-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(room.id).run();

    const response = await createBooking({ request: postReq('https://x/api/bookings', { ...validBody, roomType: 'dormitory', checkIn: '2099-02-01', checkOut: '2099-02-03' }), env });
    expect(response.status).toBe(201);
  });
});

describe('GET /api/bookings', () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Pending Guest', '090', 'circle', '2099-03-01', '2099-03-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Arriving Today', '090', 'circle', ?, ?, 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(today, tomorrow).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Leaving Today', '090', 'circle', ?, ?, 'checked_in', 'website', '2026-08-01T00:00:00Z')`
    ).bind(yesterday, today).run();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await listBookings({ request: new Request('https://x/api/bookings'), env });
    expect(response.status).toBe(401);
  });

  it('filters by status', async () => {
    const response = await listBookings({ request: authedRequest('https://x/api/bookings?status=pending', managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Pending Guest']);
  });

  it('filters arrivals by date', async () => {
    const response = await listBookings({ request: authedRequest(`https://x/api/bookings?status=confirmed&date=${today}&view=arrivals`, managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Arriving Today']);
  });

  it('filters departures by date', async () => {
    const response = await listBookings({ request: authedRequest(`https://x/api/bookings?status=checked_in&date=${today}&view=departures`, managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Leaving Today']);
  });

  it('includes overdue checked-in bookings (check_out before the queried date) in departures', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Overdue Departure', '090', 'circle', ?, ?, 'checked_in', 'website', '2026-08-01T00:00:00Z')`
    ).bind(yesterday, yesterday).run();

    const response = await listBookings({ request: authedRequest(`https://x/api/bookings?status=checked_in&date=${today}&view=departures`, managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toContain('Overdue Departure');
  });

  it('orders results by check_in ascending', async () => {
    const response = await listBookings({ request: authedRequest('https://x/api/bookings', managerToken), env });
    const body = await response.json();
    expect(body.map((b) => b.guestName)).toEqual(['Leaving Today', 'Arriving Today', 'Pending Guest']);
  });
});
