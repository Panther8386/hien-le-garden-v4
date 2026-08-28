import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as addServiceItem } from '../functions/api/bookings/[id]/services/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, observerToken;
let confirmedBookingId, pendingBookingId, checkedOutBookingId;
let activeCatalogId, inactiveCatalogId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM booking_service_items');
  await env.DB.exec('DELETE FROM service_catalog');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_svc', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_svc', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'quan_sat_svc', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 3);

  const confirmed = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Confirmed Guest', '0900000001', 'triangle', '2099-01-01', '2099-01-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
  ).run();
  confirmedBookingId = confirmed.meta.last_row_id;

  const pending = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Pending Guest', '0900000002', 'triangle', '2099-01-01', '2099-01-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
  ).run();
  pendingBookingId = pending.meta.last_row_id;

  const checkedOut = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Checked Out Guest', '0900000003', 'triangle', '2099-01-01', '2099-01-03', 'checked_out', 'website', '2026-08-01T00:00:00Z')`
  ).run();
  checkedOutBookingId = checkedOut.meta.last_row_id;

  const activeCatalog = await env.DB.prepare(
    `INSERT INTO service_catalog (category, name, price_type, price_min, display_order, is_active, updated_at) VALUES ('fnb_hoat_dong', 'Cà phê', 'fixed', 30000, 1, 1, '2026-08-01T00:00:00Z')`
  ).run();
  activeCatalogId = activeCatalog.meta.last_row_id;

  const inactiveCatalog = await env.DB.prepare(
    `INSERT INTO service_catalog (category, name, price_type, price_min, display_order, is_active, updated_at) VALUES ('fnb_hoat_dong', 'Món ngừng bán', 'fixed', 10000, 2, 0, '2026-08-01T00:00:00Z')`
  ).run();
  inactiveCatalogId = inactiveCatalog.meta.last_row_id;
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('POST /api/bookings/:id/services', () => {
  it('lets reception add a service line with a server-derived name', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${confirmedBookingId}/services`, receptionToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: 35000, quantity: 2 }),
      env,
      params: { id: String(confirmedBookingId) },
    });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(`SELECT * FROM booking_service_items WHERE booking_id = ?`).bind(confirmedBookingId).first();
    expect(row.name).toBe('Cà phê');
    expect(row.unit_price).toBe(35000);
    expect(row.quantity).toBe(2);
    expect(row.amount).toBe(70000);
    expect(row.status).toBe('posted');
    expect(row.created_by).toBe('le_tan_svc');
  });

  it('rejects a pending booking (400)', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${pendingBookingId}/services`, receptionToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: 30000, quantity: 1 }),
      env,
      params: { id: String(pendingBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a checked_out booking (400)', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${checkedOutBookingId}/services`, receptionToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: 30000, quantity: 1 }),
      env,
      params: { id: String(checkedOutBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a nonexistent booking (404)', async () => {
    const response = await addServiceItem({
      request: authedRequest('https://x/api/bookings/999999/services', receptionToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: 30000, quantity: 1 }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('rejects an inactive serviceCatalogId (400)', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${confirmedBookingId}/services`, receptionToken, 'POST', { serviceCatalogId: inactiveCatalogId, unitPrice: 10000, quantity: 1 }),
      env,
      params: { id: String(confirmedBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a nonexistent serviceCatalogId (400)', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${confirmedBookingId}/services`, receptionToken, 'POST', { serviceCatalogId: 999999, unitPrice: 10000, quantity: 1 }),
      env,
      params: { id: String(confirmedBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a negative unitPrice (400)', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${confirmedBookingId}/services`, receptionToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: -1000, quantity: 1 }),
      env,
      params: { id: String(confirmedBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a zero quantity (400)', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${confirmedBookingId}/services`, receptionToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: 10000, quantity: 0 }),
      env,
      params: { id: String(confirmedBookingId) },
    });
    expect(response.status).toBe(400);
  });

  it('lets a manager add a service line', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${confirmedBookingId}/services`, managerToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: 30000, quantity: 1 }),
      env,
      params: { id: String(confirmedBookingId) },
    });
    expect(response.status).toBe(201);
  });

  it('rejects an observer (403)', async () => {
    const response = await addServiceItem({
      request: authedRequest(`https://x/api/bookings/${confirmedBookingId}/services`, observerToken, 'POST', { serviceCatalogId: activeCatalogId, unitPrice: 30000, quantity: 1 }),
      env,
      params: { id: String(confirmedBookingId) },
    });
    expect(response.status).toBe(403);
  });
});
