import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createBooking, onRequestGet as listBookings } from '../functions/api/bookings/index.js';
import { onRequestPatch as setDeposit } from '../functions/api/bookings/[id]/deposit.js';
import { onRequestPatch as hideBooking } from '../functions/api/bookings/[id]/hide.js';
import { createSession } from '../lib/auth.js';

let managerToken;
let observerToken;
let receptionToken;
let adminToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM notification_settings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'observer_a', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 2);

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 3);

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (4, 'admin_a', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, 4);
});

function postReq(url, body) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function authedRequest(url, token, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${token}` } });
}

function authedPatchRequest(url, token, body) {
  return new Request(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: `session=${token}` }, body: JSON.stringify(body || {}) });
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
      `INSERT INTO bookings (guest_name, phone, email, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Arriving Today', '090', 'arriving@example.com', 'circle', ?, ?, 'confirmed', 'website', '2026-08-01T00:00:00Z')`
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
    expect(body.find((b) => b.guestName === 'Pending Guest').depositAmount).toBe(0);
  });

  it('lets an observer list bookings', async () => {
    const request = authedRequest('https://x/api/bookings', observerToken);
    const response = await listBookings({ request, env });
    expect(response.status).toBe(200);
  });

  it('redacts phone and email for an observer but keeps them for a manager', async () => {
    const managerResponse = await listBookings({ request: authedRequest('https://x/api/bookings', managerToken), env });
    const managerBody = await managerResponse.json();
    expect(managerBody.length).toBeGreaterThan(0);
    managerBody.forEach((b) => expect(b.phone).toBe('090'));
    const managerArriving = managerBody.find((b) => b.guestName === 'Arriving Today');
    expect(managerArriving.email).toBe('arriving@example.com');

    const observerResponse = await listBookings({ request: authedRequest('https://x/api/bookings', observerToken), env });
    const observerBody = await observerResponse.json();
    expect(observerBody.length).toBeGreaterThan(0);
    observerBody.forEach((b) => {
      expect(b.phone).toBeNull();
      expect(b.email).toBeNull();
      expect(b.guestName).not.toBeNull();
    });
    const observerArriving = observerBody.find((b) => b.guestName === 'Arriving Today');
    expect(observerArriving.email).toBeNull();
  });

  it('attaches services grouped per booking, empty array when none exist', async () => {
    await env.DB.exec('DELETE FROM booking_service_items');
    const pendingRow = await env.DB.prepare(`SELECT id FROM bookings WHERE guest_name = 'Pending Guest'`).first();
    const arrivingRow = await env.DB.prepare(`SELECT id FROM bookings WHERE guest_name = 'Arriving Today'`).first();

    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Cà phê', 30000, 1, 30000, 'posted', 'quan_ly_a', '2026-08-01T00:00:00Z')`
    ).bind(arrivingRow.id).run();

    const response = await listBookings({ request: authedRequest('https://x/api/bookings', managerToken), env });
    const body = await response.json();

    const pendingResult = body.find((b) => b.id === pendingRow.id);
    expect(pendingResult.services).toEqual([]);

    const arrivingResult = body.find((b) => b.id === arrivingRow.id);
    expect(arrivingResult.services).toHaveLength(1);
    expect(arrivingResult.services[0]).toMatchObject({ name: 'Cà phê', unitPrice: 30000, quantity: 1, amount: 30000, status: 'posted' });
  });

  it('includes experience-slot snapshot fields on scheduled service items, null on non-scheduled ones', async () => {
    await env.DB.exec('DELETE FROM booking_service_items');
    await env.DB.exec('DELETE FROM service_slot_template');
    await env.DB.exec('DELETE FROM service_catalog');
    const arrivingRow = await env.DB.prepare(`SELECT id FROM bookings WHERE guest_name = 'Arriving Today'`).first();

    // slot_template_id is a foreign key to service_slot_template(id), so a real row is needed here
    // (a bare literal id like 42 would trip the FK constraint since D1 enforces it).
    const catalogResult = await env.DB.prepare(
      `INSERT INTO service_catalog (category, name, price_type, price_min, display_order, is_active, is_scheduled, updated_at) VALUES ('fnb_hoat_dong', 'Đốt lửa trại', 'fixed', 500000, 1, 1, 1, '2026-08-01T00:00:00Z')`
    ).run();
    const catalogId = catalogResult.meta.last_row_id;
    const slotResult = await env.DB.prepare(
      `INSERT INTO service_slot_template (service_catalog_id, label, days_of_week, start_time, capacity, is_active, created_at) VALUES (?, 'Suất tối', '6', '19:00', 30, 1, '2026-08-01T00:00:00Z')`
    ).bind(catalogId).run();
    const slotTemplateId = slotResult.meta.last_row_id;

    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at, experience_date, slot_template_id, experience_slot_label, experience_start_time, terms_accepted_at)
       VALUES (?, 'Đốt lửa trại', 500000, 10, 5000000, 'posted', 'le_tan_a', '2026-08-01T00:00:00Z', '2026-08-29', ?, 'Suất tối', '19:00', '2026-08-01T00:05:00Z')`
    ).bind(arrivingRow.id, slotTemplateId).run();
    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Cà phê', 30000, 1, 30000, 'posted', 'le_tan_a', '2026-08-01T00:00:00Z')`
    ).bind(arrivingRow.id).run();

    const response = await listBookings({ request: authedRequest('https://x/api/bookings', managerToken), env });
    const body = await response.json();
    const arrivingResult = body.find((b) => b.id === arrivingRow.id);

    const scheduled = arrivingResult.services.find((s) => s.name === 'Đốt lửa trại');
    expect(scheduled).toMatchObject({
      experienceDate: '2026-08-29',
      slotTemplateId,
      experienceSlotLabel: 'Suất tối',
      experienceStartTime: '19:00',
    });
    expect(scheduled.termsAcceptedAt).toBe('2026-08-01T00:05:00Z');

    const nonScheduled = arrivingResult.services.find((s) => s.name === 'Cà phê');
    expect(nonScheduled.experienceDate).toBeNull();
    expect(nonScheduled.slotTemplateId).toBeNull();
    expect(nonScheduled.experienceSlotLabel).toBeNull();
    expect(nonScheduled.experienceStartTime).toBeNull();
    expect(nonScheduled.termsAcceptedAt).toBeNull();
  });
});

describe('PATCH /api/bookings/:id/deposit', () => {
  it('lets reception set a deposit amount', async () => {
    const created = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Deposit Test', '090', 'circle', '2026-09-01', '2026-09-02', 'pending', 'website', '2026-08-27T00:00:00Z')`
    ).run();
    const id = created.meta.last_row_id;

    const request = new Request(`https://x/api/bookings/${id}/deposit`, {
      method: 'PATCH',
      headers: { Cookie: `session=${receptionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositAmount: 200000 }),
    });
    const response = await setDeposit({ request, env, params: { id: String(id) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT deposit_amount FROM bookings WHERE id = ?`).bind(id).first();
    expect(row.deposit_amount).toBe(200000);
  });

  it('writes an audit_log row on deposit change', async () => {
    const created = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, deposit_amount, created_at)
       VALUES ('Deposit Audit Guest', '090', 'circle', '2026-09-01', '2026-09-02', 'pending', 'website', 50000, '2026-08-27T00:00:00Z')`
    ).run();
    const id = created.meta.last_row_id;

    const request = new Request(`https://x/api/bookings/${id}/deposit`, {
      method: 'PATCH',
      headers: { Cookie: `session=${receptionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositAmount: 200000 }),
    });
    const response = await setDeposit({ request, env, params: { id: String(id) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'deposit_change' AND entity_id = ?`).bind(id).first();
    expect(row.entity_type).toBe('booking');
    expect(row.entity_label).toBe('Deposit Audit Guest');
    expect(row.old_value).toBe('50000');
    expect(row.new_value).toBe('200000');
    expect(row.actor).toBe('le_tan_a');
  });

  it('rejects a negative amount (400)', async () => {
    const created = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Deposit Test 2', '090', 'circle', '2026-09-01', '2026-09-02', 'pending', 'website', '2026-08-27T00:00:00Z')`
    ).run();
    const id = created.meta.last_row_id;

    const request = new Request(`https://x/api/bookings/${id}/deposit`, {
      method: 'PATCH',
      headers: { Cookie: `session=${managerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositAmount: -1 }),
    });
    const response = await setDeposit({ request, env, params: { id: String(id) } });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const request = new Request('https://x/api/bookings/999999/deposit', {
      method: 'PATCH',
      headers: { Cookie: `session=${managerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositAmount: 100000 }),
    });
    const response = await setDeposit({ request, env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an observer (403)', async () => {
    const created = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Deposit Test 3', '090', 'circle', '2026-09-01', '2026-09-02', 'pending', 'website', '2026-08-27T00:00:00Z')`
    ).run();
    const id = created.meta.last_row_id;

    const request = new Request(`https://x/api/bookings/${id}/deposit`, {
      method: 'PATCH',
      headers: { Cookie: `session=${observerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositAmount: 100000 }),
    });
    const response = await setDeposit({ request, env, params: { id: String(id) } });
    expect(response.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const request = new Request('https://x/api/bookings/1/deposit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositAmount: 100000 }),
    });
    const response = await setDeposit({ request, env, params: { id: '1' } });
    expect(response.status).toBe(401);
  });
});

describe('GET /api/bookings — is_hidden filtering', () => {
  it('excludes hidden bookings by default', async () => {
    const booking = await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at, is_hidden) VALUES ('Khách Ẩn', '0900000001', 'circle', '2026-09-10', '2026-09-11', 'cancelled', 'phone', '2026-09-05T00:00:00Z', 1)`).run();
    const response = await listBookings({ request: authedRequest('https://x/api/bookings?status=cancelled', adminToken, 'GET'), env });
    const body = await response.json();
    expect(body.find((b) => b.id === booking.meta.last_row_id)).toBeUndefined();
  });

  it('includes hidden bookings when includeHidden=1 and role is admin', async () => {
    const booking = await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at, is_hidden) VALUES ('Khách Ẩn', '0900000001', 'circle', '2026-09-10', '2026-09-11', 'cancelled', 'phone', '2026-09-05T00:00:00Z', 1)`).run();
    const response = await listBookings({ request: authedRequest('https://x/api/bookings?status=cancelled&includeHidden=1', adminToken, 'GET'), env });
    const body = await response.json();
    const found = body.find((b) => b.id === booking.meta.last_row_id);
    expect(found).toBeTruthy();
    expect(found.isHidden).toBe(true);
  });

  it('ignores includeHidden=1 for a non-admin role', async () => {
    const booking = await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at, is_hidden) VALUES ('Khách Ẩn', '0900000001', 'circle', '2026-09-10', '2026-09-11', 'cancelled', 'phone', '2026-09-05T00:00:00Z', 1)`).run();
    const response = await listBookings({ request: authedRequest('https://x/api/bookings?status=cancelled&includeHidden=1', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.find((b) => b.id === booking.meta.last_row_id)).toBeUndefined();
  });
});

describe('PATCH /api/bookings/:id/hide', () => {
  let cancelledBookingId, pendingBookingId;
  beforeEach(async () => {
    const cancelled = await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Khách Đã Huỷ', '0900000001', 'circle', '2026-09-10', '2026-09-11', 'cancelled', 'phone', '2026-09-05T00:00:00Z')`).run();
    cancelledBookingId = cancelled.meta.last_row_id;
    const pending = await env.DB.prepare(`INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Khách Đang Chờ', '0900000002', 'circle', '2026-09-12', '2026-09-13', 'pending', 'phone', '2026-09-05T00:00:00Z')`).run();
    pendingBookingId = pending.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await hideBooking({ request: new Request(`https://x/api/bookings/${cancelledBookingId}/hide`, { method: 'PATCH' }), env, params: { id: String(cancelledBookingId) } });
    expect(response.status).toBe(401);
  });

  it('rejects manager (403) — hiding is admin-only', async () => {
    const response = await hideBooking({ request: authedRequest(`https://x/api/bookings/${cancelledBookingId}/hide`, managerToken, 'PATCH'), env, params: { id: String(cancelledBookingId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent booking', async () => {
    const response = await hideBooking({ request: authedRequest('https://x/api/bookings/999999/hide', adminToken, 'PATCH'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects hiding a booking that is still pending (400)', async () => {
    const response = await hideBooking({ request: authedRequest(`https://x/api/bookings/${pendingBookingId}/hide`, adminToken, 'PATCH'), env, params: { id: String(pendingBookingId) } });
    expect(response.status).toBe(400);
  });

  it('hides a cancelled booking and writes a record_hide audit_log row', async () => {
    const response = await hideBooking({ request: authedPatchRequest(`https://x/api/bookings/${cancelledBookingId}/hide`, adminToken, { hidden: true }), env, params: { id: String(cancelledBookingId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT is_hidden FROM bookings WHERE id = ?`).bind(cancelledBookingId).first();
    expect(row.is_hidden).toBe(1);
    const auditRow = await env.DB.prepare(`SELECT action_type, entity_type, old_value, new_value FROM audit_log WHERE entity_type = 'booking' AND entity_id = ?`).bind(cancelledBookingId).first();
    expect(auditRow).toEqual({ action_type: 'record_hide', entity_type: 'booking', old_value: 'hiện', new_value: 'ẩn' });
  });

  it('unhides a hidden booking (hidden: false)', async () => {
    await env.DB.prepare(`UPDATE bookings SET is_hidden = 1 WHERE id = ?`).bind(cancelledBookingId).run();
    const response = await hideBooking({ request: authedPatchRequest(`https://x/api/bookings/${cancelledBookingId}/hide`, adminToken, { hidden: false }), env, params: { id: String(cancelledBookingId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT is_hidden FROM bookings WHERE id = ?`).bind(cancelledBookingId).first();
    expect(row.is_hidden).toBe(0);
  });
});
