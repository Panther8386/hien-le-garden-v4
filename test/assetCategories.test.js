import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listCategories, onRequestPost as createCategory } from '../functions/api/asset-categories/index.js';
import { onRequestPatch as patchCategory } from '../functions/api/asset-categories/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM asset_categories');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_ac', 'x', 'manager', '2026-09-07T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_ac', 'x', 'reception', '2026-09-07T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_ac', 'x', 'admin', '2026-09-07T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_ac', 'x', 'observer', '2026-09-07T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/asset-categories', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listCategories({ request: new Request('https://x/api/asset-categories'), env });
    expect(response.status).toBe(401);
  });

  it('lets all 4 roles read', async () => {
    for (const token of [managerToken, receptionToken, adminToken, observerToken]) {
      const response = await listCategories({ request: authedRequest('https://x/api/asset-categories', token, 'GET'), env });
      expect(response.status).toBe(200);
    }
  });

  it('excludes inactive categories by default', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_categories (management_type, name, default_unit, is_active, created_by, created_at) VALUES ('linen', 'Khăn cũ', 'cái', 0, 'admin_ac', '2026-09-07T00:00:00Z')`
    ).run();
    const response = await listCategories({ request: authedRequest('https://x/api/asset-categories', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(0);
  });

  it('includes inactive categories with includeInactive=1', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_categories (management_type, name, default_unit, is_active, created_by, created_at) VALUES ('linen', 'Khăn cũ', 'cái', 0, 'admin_ac', '2026-09-07T00:00:00Z')`
    ).run();
    const response = await listCategories({ request: authedRequest('https://x/api/asset-categories?includeInactive=1', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].isActive).toBe(false);
  });
});

describe('POST /api/asset-categories', () => {
  it('rejects manager (403) — write is admin-only', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/asset-categories', managerToken, 'POST', { managementType: 'linen', name: 'X', defaultUnit: 'cái' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects reception (403)', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/asset-categories', receptionToken, 'POST', { managementType: 'linen', name: 'X', defaultUnit: 'cái' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid managementType (400)', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/asset-categories', adminToken, 'POST', { managementType: 'not_real', name: 'X', defaultUnit: 'cái' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a missing name (400)', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/asset-categories', adminToken, 'POST', { managementType: 'linen', name: '', defaultUnit: 'cái' }), env });
    expect(response.status).toBe(400);
  });

  it('creates a category as admin and writes an audit_log row', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/asset-categories', adminToken, 'POST', { managementType: 'individual_device', name: 'Điều hoà', defaultUnit: 'bộ', note: 'Ghi chú' }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT * FROM asset_categories WHERE id = ?`).bind(body.id).first();
    expect(row.management_type).toBe('individual_device');
    expect(row.name).toBe('Điều hoà');
    expect(row.is_active).toBe(1);
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_category_create' AND entity_id = ?`).bind(body.id).first();
    expect(audit.entity_type).toBe('asset_category');
    expect(audit.entity_label).toBe('Điều hoà');
  });
});

describe('PATCH /api/asset-categories/:id', () => {
  let categoryId;

  beforeEach(async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('linen', 'Khăn', 'cái', 'admin_ac', '2026-09-07T00:00:00Z')`
    ).run();
    categoryId = insert.meta.last_row_id;
  });

  it('rejects manager (403)', async () => {
    const response = await patchCategory({ request: authedRequest(`https://x/api/asset-categories/${categoryId}`, managerToken, 'PATCH', { name: 'Khăn mới' }), env, params: { id: String(categoryId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await patchCategory({ request: authedRequest('https://x/api/asset-categories/999999', adminToken, 'PATCH', { name: 'X' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an attempt to change managementType (400)', async () => {
    const response = await patchCategory({ request: authedRequest(`https://x/api/asset-categories/${categoryId}`, adminToken, 'PATCH', { managementType: 'consumable' }), env, params: { id: String(categoryId) } });
    expect(response.status).toBe(400);
  });

  it('updates name/defaultUnit/note and writes an audit_log row', async () => {
    const response = await patchCategory({ request: authedRequest(`https://x/api/asset-categories/${categoryId}`, adminToken, 'PATCH', { name: 'Khăn tắm', defaultUnit: 'chiếc', note: 'Đổi tên' }), env, params: { id: String(categoryId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT name, default_unit, note FROM asset_categories WHERE id = ?`).bind(categoryId).first();
    expect(row).toEqual({ name: 'Khăn tắm', default_unit: 'chiếc', note: 'Đổi tên' });
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_category_update' AND entity_id = ?`).bind(categoryId).first();
    expect(audit.old_value).toBe('Khăn');
    expect(audit.new_value).toBe('Khăn tắm');
  });

  it('toggles isActive to false and back to true', async () => {
    await patchCategory({ request: authedRequest(`https://x/api/asset-categories/${categoryId}`, adminToken, 'PATCH', { isActive: false }), env, params: { id: String(categoryId) } });
    let row = await env.DB.prepare(`SELECT is_active FROM asset_categories WHERE id = ?`).bind(categoryId).first();
    expect(row.is_active).toBe(0);
    await patchCategory({ request: authedRequest(`https://x/api/asset-categories/${categoryId}`, adminToken, 'PATCH', { isActive: true }), env, params: { id: String(categoryId) } });
    row = await env.DB.prepare(`SELECT is_active FROM asset_categories WHERE id = ?`).bind(categoryId).first();
    expect(row.is_active).toBe(1);
  });
});
