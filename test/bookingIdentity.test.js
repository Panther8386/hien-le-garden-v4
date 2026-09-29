import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getBooking } from '../functions/api/bookings/[id]/index.js';
import { onRequestPatch as setIdentity } from '../functions/api/bookings/[id]/identity.js';
import { createSession } from '../lib/auth.js';
import { setOverride } from './helpers/permissions.js';

let managerToken, receptionToken, observerToken, receptionStaffId;

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
  receptionStaffId = r.meta.last_row_id;
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

describe('PATCH /api/bookings/:id/identity', () => {
  let bookingId;
  beforeEach(async () => {
    const created = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Identity Test Guest', '0900000002', 'circle', '2026-09-10', '2026-09-12', 'confirmed', 'website', '2026-09-04T00:00:00Z')`
    ).run();
    bookingId = created.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await setIdentity({ request: new Request(`https://x/api/bookings/${bookingId}/identity`, { method: 'PATCH' }), env, params: { id: String(bookingId) } });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await setIdentity({ request: authedRequest(`https://x/api/bookings/${bookingId}/identity`, observerToken, 'PATCH', { idNumber: '079123456789' }), env, params: { id: String(bookingId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await setIdentity({ request: authedRequest('https://x/api/bookings/999999/identity', receptionToken, 'PATCH', { idNumber: '079123456789' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an id_number over 200 characters (400)', async () => {
    const response = await setIdentity({ request: authedRequest(`https://x/api/bookings/${bookingId}/identity`, receptionToken, 'PATCH', { idNumber: 'x'.repeat(201) }), env, params: { id: String(bookingId) } });
    expect(response.status).toBe(400);
  });

  it('lets reception save both fields and writes an audit_log row', async () => {
    const response = await setIdentity({ request: authedRequest(`https://x/api/bookings/${bookingId}/identity`, receptionToken, 'PATCH', { idNumber: '079123456789', nationality: 'Việt Nam' }), env, params: { id: String(bookingId) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT id_number, nationality FROM bookings WHERE id = ?`).bind(bookingId).first();
    expect(row).toEqual({ id_number: '079123456789', nationality: 'Việt Nam' });

    const auditRow = await env.DB.prepare(`SELECT * FROM audit_log WHERE entity_type = 'booking' AND entity_id = ? AND action_type = 'guest_identity_update'`).bind(bookingId).first();
    expect(auditRow).not.toBeNull();
    expect(auditRow.actor).toBe('le_tan_id');
  });

  it('stores an empty string as null', async () => {
    await setIdentity({ request: authedRequest(`https://x/api/bookings/${bookingId}/identity`, receptionToken, 'PATCH', { idNumber: '079123456789', nationality: 'Việt Nam' }), env, params: { id: String(bookingId) } });
    const response = await setIdentity({ request: authedRequest(`https://x/api/bookings/${bookingId}/identity`, receptionToken, 'PATCH', { idNumber: '', nationality: '' }), env, params: { id: String(bookingId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT id_number, nationality FROM bookings WHERE id = ?`).bind(bookingId).first();
    expect(row).toEqual({ id_number: null, nationality: null });
  });

  it('does not touch other booking fields', async () => {
    await setIdentity({ request: authedRequest(`https://x/api/bookings/${bookingId}/identity`, receptionToken, 'PATCH', { idNumber: '079123456789' }), env, params: { id: String(bookingId) } });
    const row = await env.DB.prepare(`SELECT guest_name, phone, status FROM bookings WHERE id = ?`).bind(bookingId).first();
    expect(row).toEqual({ guest_name: 'Identity Test Guest', phone: '0900000002', status: 'confirmed' });
  });
});

describe('GET & PATCH /api/bookings/:id — hidden record requires records.hide (F-3)', () => {
  let hiddenId;
  beforeEach(async () => {
    const created = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at, is_hidden)
       VALUES ('Khách Ẩn', '0900000009', 'circle', '2026-09-10', '2026-09-12', 'cancelled', 'website', '2026-09-04T00:00:00Z', 1)`
    ).run();
    hiddenId = created.meta.last_row_id;
  });

  it('GET answers a hidden booking exactly like a non-existent id for reception (no records.hide)', async () => {
    const missing = await getBooking({ request: authedRequest('https://x/api/bookings/999999', receptionToken, 'GET'), env, params: { id: '999999' } });
    const response = await getBooking({ request: authedRequest(`https://x/api/bookings/${hiddenId}`, receptionToken, 'GET'), env, params: { id: String(hiddenId) } });
    const missingBody = await missing.json();
    expect(missing.status).toBe(404);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(missingBody);
  });

  it('GET returns 200 for a user granted records.hide', async () => {
    await setOverride(env.DB, receptionStaffId, 'records.hide');
    const response = await getBooking({ request: authedRequest(`https://x/api/bookings/${hiddenId}`, receptionToken, 'GET'), env, params: { id: String(hiddenId) } });
    expect(response.status).toBe(200);
  });

  it('PATCH identity answers a hidden booking exactly like a non-existent id, row left unchanged', async () => {
    const missing = await setIdentity({ request: authedRequest('https://x/api/bookings/999999/identity', receptionToken, 'PATCH', { idNumber: '079999999999' }), env, params: { id: '999999' } });
    const response = await setIdentity({ request: authedRequest(`https://x/api/bookings/${hiddenId}/identity`, receptionToken, 'PATCH', { idNumber: '079999999999' }), env, params: { id: String(hiddenId) } });
    const missingBody = await missing.json();
    expect(missing.status).toBe(404);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(missingBody);
    const row = await env.DB.prepare(`SELECT id_number FROM bookings WHERE id = ?`).bind(hiddenId).first();
    expect(row.id_number).toBeNull();
  });

  it('PATCH identity works (200) for a user granted records.hide', async () => {
    await setOverride(env.DB, receptionStaffId, 'records.hide');
    const response = await setIdentity({ request: authedRequest(`https://x/api/bookings/${hiddenId}/identity`, receptionToken, 'PATCH', { idNumber: '079999999999' }), env, params: { id: String(hiddenId) } });
    expect(response.status).toBe(200);
  });

  it('does not affect a non-hidden booking for the same user (regression)', async () => {
    const visible = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Khách Thường', '0900000008', 'circle', '2026-09-10', '2026-09-12', 'confirmed', 'website', '2026-09-04T00:00:00Z')`
    ).run();
    const id = visible.meta.last_row_id;
    const getResponse = await getBooking({ request: authedRequest(`https://x/api/bookings/${id}`, receptionToken, 'GET'), env, params: { id: String(id) } });
    expect(getResponse.status).toBe(200);
    const patchResponse = await setIdentity({ request: authedRequest(`https://x/api/bookings/${id}/identity`, receptionToken, 'PATCH', { idNumber: '079111111111' }), env, params: { id: String(id) } });
    expect(patchResponse.status).toBe(200);
  });
});
