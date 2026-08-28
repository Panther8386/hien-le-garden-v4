import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getCatalog, onRequestPost as postCatalog } from '../functions/api/catalog/index.js';
import { onRequestPatch as patchCatalog, onRequestDelete as deleteCatalog } from '../functions/api/catalog/[id].js';
import { createSession } from '../lib/auth.js';

let managerId, receptionId, adminId, observerId, managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM service_catalog');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_catalog', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_catalog', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_catalog', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_catalog', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerId = m.meta.last_row_id;
  receptionId = r.meta.last_row_id;
  adminId = a.meta.last_row_id;
  observerId = o.meta.last_row_id;
  managerToken = await createSession(env.DB, managerId);
  receptionToken = await createSession(env.DB, receptionId);
  adminToken = await createSession(env.DB, adminId);
  observerToken = await createSession(env.DB, observerId);

  await env.DB.prepare(
    `INSERT INTO service_catalog (category, subgroup, name, price_type, price_min, price_max, unit_capacity, note, room_type_key, display_order, is_active, updated_by, updated_at)
     VALUES ('luu_tru', 'Lưu Trú Theo Đêm', 'Triangle House Test', 'fixed', 300000, NULL, '2–3 người', 'note', 'triangle', 1, 1, 'seed', '2026-08-01T00:00:00Z')`
  ).run();
  await env.DB.prepare(
    `INSERT INTO service_catalog (category, subgroup, name, price_type, price_min, price_max, unit_capacity, note, room_type_key, display_order, is_active, updated_by, updated_at)
     VALUES ('fnb_hoat_dong', NULL, 'Inactive Item', 'range', 10000, 20000, '/ phần', NULL, NULL, 1, 0, 'seed', '2026-08-01T00:00:00Z')`
  ).run();
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/catalog', () => {
  it('is public: returns active rows with no session at all', async () => {
    const response = await getCatalog({ request: new Request('https://x/api/catalog'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: 'Triangle House Test', priceType: 'fixed', priceMin: 300000, roomTypeKey: 'triangle', isActive: true });
  });

  it('?all=1 without a session returns 401', async () => {
    const response = await getCatalog({ request: new Request('https://x/api/catalog?all=1'), env });
    expect(response.status).toBe(401);
  });

  it('?all=1 with a staff session returns inactive rows too', async () => {
    const response = await getCatalog({ request: authedRequest('https://x/api/catalog?all=1', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
  });
});

describe('POST /api/catalog', () => {
  it('lets an admin create a range-priced row', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', adminToken, 'POST', {
        category: 'fnb_hoat_dong', name: 'Trà đá', priceType: 'range', priceMin: 10000, priceMax: 20000, unitCapacity: '/ ly',
      }),
      env,
    });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(`SELECT * FROM service_catalog WHERE name = 'Trà đá'`).first();
    expect(row.price_min).toBe(10000);
    expect(row.price_max).toBe(20000);
    expect(row.updated_by).toBe('admin_catalog');
  });

  it('lets an admin create a label-priced row', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', adminToken, 'POST', {
        category: 'su_kien_team_building', name: 'Dịch vụ đặc biệt', priceType: 'label', priceLabel: 'Liên hệ',
      }),
      env,
    });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(`SELECT price_label, price_min FROM service_catalog WHERE name = 'Dịch vụ đặc biệt'`).first();
    expect(row.price_label).toBe('Liên hệ');
    expect(row.price_min).toBeNull();
  });

  it('rejects a range row missing priceMax (400)', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', adminToken, 'POST', { category: 'fnb_hoat_dong', name: 'Bad range', priceType: 'range', priceMin: 10000 }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a label row missing priceLabel (400)', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', adminToken, 'POST', { category: 'fnb_hoat_dong', name: 'Bad label', priceType: 'label' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid roomTypeKey (400)', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', adminToken, 'POST', { category: 'luu_tru', name: 'Bad key', priceType: 'fixed', priceMin: 100000, roomTypeKey: 'not_a_room' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a roomTypeKey already claimed by an active row (400)', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', adminToken, 'POST', { category: 'luu_tru', name: 'Duplicate triangle', priceType: 'fixed', priceMin: 100000, roomTypeKey: 'triangle' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects manager (403) -- write is admin-only, not the usual manager+admin', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', managerToken, 'POST', { category: 'fnb_hoat_dong', name: 'x', priceType: 'fixed', priceMin: 1000 }),
      env,
    });
    expect(response.status).toBe(403);
  });

  it('rejects reception (403)', async () => {
    const response = await postCatalog({
      request: authedRequest('https://x/api/catalog', receptionToken, 'POST', { category: 'fnb_hoat_dong', name: 'x', priceType: 'fixed', priceMin: 1000 }),
      env,
    });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/catalog/:id', () => {
  it('lets an admin edit a row and switch price_type, clearing the old fields', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM service_catalog WHERE name = 'Triangle House Test'`).first();
    const response = await patchCatalog({
      request: authedRequest(`https://x/api/catalog/${existing.id}`, adminToken, 'PATCH', { priceType: 'label', priceLabel: 'Liên hệ' }),
      env,
      params: { id: String(existing.id) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT price_type, price_label, price_min FROM service_catalog WHERE id = ?`).bind(existing.id).first();
    expect(row.price_type).toBe('label');
    expect(row.price_label).toBe('Liên hệ');
    expect(row.price_min).toBeNull();
  });

  it('allows re-saving the same row without tripping its own roomTypeKey uniqueness check', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM service_catalog WHERE room_type_key = 'triangle'`).first();
    const response = await patchCatalog({
      request: authedRequest(`https://x/api/catalog/${existing.id}`, adminToken, 'PATCH', { note: 'updated note' }),
      env,
      params: { id: String(existing.id) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects manager (403)', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM service_catalog WHERE name = 'Triangle House Test'`).first();
    const response = await patchCatalog({
      request: authedRequest(`https://x/api/catalog/${existing.id}`, managerToken, 'PATCH', { note: 'x' }),
      env,
      params: { id: String(existing.id) },
    });
    expect(response.status).toBe(403);
  });

  it('404s for a missing id', async () => {
    const response = await patchCatalog({ request: authedRequest('https://x/api/catalog/999999', adminToken, 'PATCH', { note: 'x' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/catalog/:id', () => {
  it('lets an admin delete a row', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM service_catalog WHERE name = 'Triangle House Test'`).first();
    const response = await deleteCatalog({ request: authedRequest(`https://x/api/catalog/${existing.id}`, adminToken, 'DELETE'), env, params: { id: String(existing.id) } });
    expect(response.status).toBe(204);
    const row = await env.DB.prepare(`SELECT id FROM service_catalog WHERE id = ?`).bind(existing.id).first();
    expect(row).toBeNull();
  });

  it('rejects reception (403)', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM service_catalog WHERE name = 'Triangle House Test'`).first();
    const response = await deleteCatalog({ request: authedRequest(`https://x/api/catalog/${existing.id}`, receptionToken, 'DELETE'), env, params: { id: String(existing.id) } });
    expect(response.status).toBe(403);
  });

  it('404s for a missing id', async () => {
    const response = await deleteCatalog({ request: authedRequest('https://x/api/catalog/999999', adminToken, 'DELETE'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });
});
