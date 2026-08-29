// v4/test/experienceSlots.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTemplates, onRequestPost as createTemplate } from '../functions/api/catalog/[id]/slot-templates/index.js';
import { onRequestPatch as patchTemplate } from '../functions/api/catalog/[id]/slot-templates/[templateId].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;
let scheduledCatalogId, plainCatalogId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM service_catalog');
  await env.DB.exec('DELETE FROM service_slot_template');
  await env.DB.exec('DELETE FROM booking_service_items');
  await env.DB.exec('DELETE FROM bookings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_es', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_es', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'admin_es', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, 3);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (4, 'quan_sat_es', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 4);

  const scheduled = await env.DB.prepare(
    `INSERT INTO service_catalog (category, name, price_type, price_min, display_order, is_active, is_scheduled, updated_at) VALUES ('fnb_hoat_dong', 'Đốt lửa trại', 'fixed', 500000, 1, 1, 1, '2026-08-01T00:00:00Z')`
  ).run();
  scheduledCatalogId = scheduled.meta.last_row_id;

  const plain = await env.DB.prepare(
    `INSERT INTO service_catalog (category, name, price_type, price_min, display_order, is_active, is_scheduled, updated_at) VALUES ('fnb_hoat_dong', 'Cà phê', 'fixed', 30000, 2, 1, 0, '2026-08-01T00:00:00Z')`
  ).run();
  plainCatalogId = plain.meta.last_row_id;

  // Create a booking for booking_service_items tests
  await env.DB.prepare(
    `INSERT INTO bookings (id, guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES (1, 'Test Guest', '0900000001', 'circle', '2026-08-29', '2026-08-30', 'pending', 'website', '2026-08-01T00:00:00Z')`
  ).run();
});

function authedRequest(url, token, method = 'GET', body) {
  const headers = token ? { Cookie: `session=${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/catalog/:id/slot-templates', () => {
  it('returns all templates for a catalog item, active and inactive', async () => {
    await env.DB.prepare(`INSERT INTO service_slot_template (service_catalog_id, label, days_of_week, start_time, capacity, is_active, created_at) VALUES (?, 'Suất tối', '5,6,0', '19:00', 30, 1, '2026-08-01T00:00:00Z')`).bind(scheduledCatalogId).run();
    await env.DB.prepare(`INSERT INTO service_slot_template (service_catalog_id, label, days_of_week, start_time, capacity, is_active, created_at) VALUES (?, 'Suất cũ', '1', '10:00', 10, 0, '2026-08-01T00:00:00Z')`).bind(scheduledCatalogId).run();

    const response = await listTemplates({ request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, receptionToken), env, params: { id: String(scheduledCatalogId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBe(2);
    expect(body[0].label).toBe('Suất cũ');
    expect(body[0].isActive).toBe(false);
    expect(body[1].daysOfWeek).toBe('5,6,0');
    expect(body[1].isActive).toBe(true);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await listTemplates({ request: new Request(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`), env, params: { id: String(scheduledCatalogId) } });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/catalog/:id/slot-templates', () => {
  it('lets an admin create a slot template', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, adminToken, 'POST', { label: 'Suất tối', daysOfWeek: [5, 6, 0], startTime: '19:00', capacity: 30 }),
      env,
      params: { id: String(scheduledCatalogId) },
    });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(`SELECT * FROM service_slot_template WHERE service_catalog_id = ?`).bind(scheduledCatalogId).first();
    expect(row.label).toBe('Suất tối');
    expect(row.days_of_week).toBe('5,6,0');
    expect(row.start_time).toBe('19:00');
    expect(row.capacity).toBe(30);
    expect(row.created_by).toBe('admin_es');
  });

  it('rejects a manager (403) -- admin-only', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, managerToken, 'POST', { label: 'x', daysOfWeek: [5], startTime: '19:00', capacity: 10 }),
      env,
      params: { id: String(scheduledCatalogId) },
    });
    expect(response.status).toBe(403);
  });

  it('rejects an empty daysOfWeek (400)', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, adminToken, 'POST', { daysOfWeek: [], startTime: '19:00', capacity: 10 }),
      env,
      params: { id: String(scheduledCatalogId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects an out-of-range day (400)', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, adminToken, 'POST', { daysOfWeek: [7], startTime: '19:00', capacity: 10 }),
      env,
      params: { id: String(scheduledCatalogId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a duplicated day (400)', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, adminToken, 'POST', { daysOfWeek: [5, 5], startTime: '19:00', capacity: 10 }),
      env,
      params: { id: String(scheduledCatalogId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed startTime (400)', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, adminToken, 'POST', { daysOfWeek: [5], startTime: '25:99', capacity: 10 }),
      env,
      params: { id: String(scheduledCatalogId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-positive capacity (400)', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates`, adminToken, 'POST', { daysOfWeek: [5], startTime: '19:00', capacity: 0 }),
      env,
      params: { id: String(scheduledCatalogId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects creating a template for a non-scheduled catalog item (400)', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/${plainCatalogId}/slot-templates`, adminToken, 'POST', { daysOfWeek: [5], startTime: '19:00', capacity: 10 }),
      env,
      params: { id: String(plainCatalogId) },
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 for a nonexistent catalog item', async () => {
    const response = await createTemplate({
      request: authedRequest(`https://x/api/catalog/999999/slot-templates`, adminToken, 'POST', { daysOfWeek: [5], startTime: '19:00', capacity: 10 }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/catalog/:id/slot-templates/:templateId', () => {
  async function createExistingTemplate() {
    const result = await env.DB.prepare(
      `INSERT INTO service_slot_template (service_catalog_id, label, days_of_week, start_time, capacity, is_active, created_at) VALUES (?, 'Suất tối', '5,6,0', '19:00', 30, 1, '2026-08-01T00:00:00Z')`
    ).bind(scheduledCatalogId).run();
    return result.meta.last_row_id;
  }

  it('lets an admin edit a template', async () => {
    const templateId = await createExistingTemplate();
    const response = await patchTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates/${templateId}`, adminToken, 'PATCH', { label: 'Suất tối mới', daysOfWeek: [6, 0], startTime: '20:00', capacity: 25 }),
      env,
      params: { id: String(scheduledCatalogId), templateId: String(templateId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT * FROM service_slot_template WHERE id = ?`).bind(templateId).first();
    expect(row.label).toBe('Suất tối mới');
    expect(row.days_of_week).toBe('6,0');
    expect(row.start_time).toBe('20:00');
    expect(row.capacity).toBe(25);
  });

  it('lets an admin deactivate a template', async () => {
    const templateId = await createExistingTemplate();
    const response = await patchTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates/${templateId}`, adminToken, 'PATCH', { isActive: false }),
      env,
      params: { id: String(scheduledCatalogId), templateId: String(templateId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT is_active FROM service_slot_template WHERE id = ?`).bind(templateId).first();
    expect(row.is_active).toBe(0);
  });

  it('rejects a manager (403)', async () => {
    const templateId = await createExistingTemplate();
    const response = await patchTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates/${templateId}`, managerToken, 'PATCH', { isActive: false }),
      env,
      params: { id: String(scheduledCatalogId), templateId: String(templateId) },
    });
    expect(response.status).toBe(403);
  });

  it('404s for a nonexistent template id', async () => {
    const response = await patchTemplate({
      request: authedRequest(`https://x/api/catalog/${scheduledCatalogId}/slot-templates/999999`, adminToken, 'PATCH', { isActive: false }),
      env,
      params: { id: String(scheduledCatalogId), templateId: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('404s when the template belongs to a different catalog item', async () => {
    const templateId = await createExistingTemplate();
    const response = await patchTemplate({
      request: authedRequest(`https://x/api/catalog/${plainCatalogId}/slot-templates/${templateId}`, adminToken, 'PATCH', { isActive: false }),
      env,
      params: { id: String(plainCatalogId), templateId: String(templateId) },
    });
    expect(response.status).toBe(404);
  });
});

import { onRequestGet as getAvailability } from '../functions/api/catalog/[id]/slot-availability.js';

describe('GET /api/catalog/:id/slot-availability', () => {
  async function createTemplate({ label, daysOfWeek, startTime, capacity }) {
    const result = await env.DB.prepare(
      `INSERT INTO service_slot_template (service_catalog_id, label, days_of_week, start_time, capacity, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, '2026-08-01T00:00:00Z')`
    ).bind(scheduledCatalogId, label, daysOfWeek, startTime, capacity).run();
    return result.meta.last_row_id;
  }

  it('returns only templates matching the requested date\'s weekday', async () => {
    // 2026-08-29 is a Saturday (weekday 6)
    await createTemplate({ label: 'Suất tối T7', daysOfWeek: '6', startTime: '19:00', capacity: 30 });
    await createTemplate({ label: 'Suất sáng T2', daysOfWeek: '1', startTime: '08:00', capacity: 10 });

    const response = await getAvailability({ request: new Request(`https://x/api/catalog/${scheduledCatalogId}/slot-availability?date=2026-08-29`, { headers: { Cookie: `session=${receptionToken}` } }), env, params: { id: String(scheduledCatalogId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBe(1);
    expect(body[0].label).toBe('Suất tối T7');
    expect(body[0].remaining).toBe(30);
  });

  it('subtracts posted bookings for that exact (template, date) pair', async () => {
    const templateId = await createTemplate({ label: 'Suất tối', daysOfWeek: '6', startTime: '19:00', capacity: 30 });
    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, service_catalog_id, name, unit_price, quantity, amount, status, slot_template_id, experience_date, created_by, created_at)
       VALUES (1, ?, 'Đốt lửa trại', 500000, 12, 6000000, 'posted', ?, '2026-08-29', 'le_tan_es', '2026-08-01T00:00:00Z')`
    ).bind(scheduledCatalogId, templateId).run();

    const response = await getAvailability({ request: new Request(`https://x/api/catalog/${scheduledCatalogId}/slot-availability?date=2026-08-29`, { headers: { Cookie: `session=${receptionToken}` } }), env, params: { id: String(scheduledCatalogId) } });
    const body = await response.json();
    expect(body[0].booked).toBe(12);
    expect(body[0].remaining).toBe(18);
  });

  it('does not let a booking on a different date affect remaining', async () => {
    const templateId = await createTemplate({ label: 'Suất tối', daysOfWeek: '6', startTime: '19:00', capacity: 30 });
    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, service_catalog_id, name, unit_price, quantity, amount, status, slot_template_id, experience_date, created_by, created_at)
       VALUES (1, ?, 'Đốt lửa trại', 500000, 12, 6000000, 'posted', ?, '2026-09-05', 'le_tan_es', '2026-08-01T00:00:00Z')`
    ).bind(scheduledCatalogId, templateId).run();

    const response = await getAvailability({ request: new Request(`https://x/api/catalog/${scheduledCatalogId}/slot-availability?date=2026-08-29`, { headers: { Cookie: `session=${receptionToken}` } }), env, params: { id: String(scheduledCatalogId) } });
    const body = await response.json();
    expect(body[0].booked).toBe(0);
    expect(body[0].remaining).toBe(30);
  });

  it('excludes an inactive template', async () => {
    await env.DB.prepare(
      `INSERT INTO service_slot_template (service_catalog_id, label, days_of_week, start_time, capacity, is_active, created_at) VALUES (?, 'Cũ', '6', '19:00', 30, 0, '2026-08-01T00:00:00Z')`
    ).bind(scheduledCatalogId).run();

    const response = await getAvailability({ request: new Request(`https://x/api/catalog/${scheduledCatalogId}/slot-availability?date=2026-08-29`, { headers: { Cookie: `session=${receptionToken}` } }), env, params: { id: String(scheduledCatalogId) } });
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('rejects a malformed date (400)', async () => {
    const response = await getAvailability({ request: new Request(`https://x/api/catalog/${scheduledCatalogId}/slot-availability?date=29-08-2026`, { headers: { Cookie: `session=${receptionToken}` } }), env, params: { id: String(scheduledCatalogId) } });
    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await getAvailability({ request: new Request(`https://x/api/catalog/${scheduledCatalogId}/slot-availability?date=2026-08-29`), env, params: { id: String(scheduledCatalogId) } });
    expect(response.status).toBe(401);
  });
});
