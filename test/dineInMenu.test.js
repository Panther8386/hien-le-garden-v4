import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listMenu, onRequestPost as createMenuItem } from '../functions/api/dine-in-menu/index.js';
import { onRequestPatch as patchMenuItem } from '../functions/api/dine-in-menu/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM dine_in_menu_items');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_menu', 'x', 'manager', '2026-09-04T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_menu', 'x', 'reception', '2026-09-04T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_menu', 'x', 'admin', '2026-09-04T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_menu', 'x', 'observer', '2026-09-04T00:00:00Z')`).run();
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

describe('GET /api/dine-in-menu', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listMenu({ request: new Request('https://x/api/dine-in-menu'), env });
    expect(response.status).toBe(401);
  });

  it('allows reception, manager, admin, and observer to read', async () => {
    for (const token of [receptionToken, managerToken, adminToken, observerToken]) {
      const response = await listMenu({ request: authedRequest('https://x/api/dine-in-menu', token, 'GET'), env });
      expect(response.status).toBe(200);
    }
  });

  it('returns created items including inactive ones', async () => {
    await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Cà phê đen', 'do_uong', 25000, 1, 0, 'system', '2026-09-04T00:00:00Z')`).run();
    const response = await listMenu({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'GET'), env });
    const body = await response.json();
    expect(body).toEqual([
      { id: expect.any(Number), name: 'Cà phê đen', category: 'do_uong', price: 25000, displayOrder: 1, isActive: false, updatedBy: 'system', updatedAt: '2026-09-04T00:00:00Z' },
    ]);
  });
});

describe('POST /api/dine-in-menu', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await createMenuItem({ request: new Request('https://x/api/dine-in-menu', { method: 'POST' }), env });
    expect(response.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    for (const token of [receptionToken, managerToken, observerToken]) {
      const response = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', token, 'POST', { name: 'Mì Quảng', category: 'mon_an', price: 45000 }), env });
      expect(response.status).toBe(403);
    }
  });

  it('rejects an invalid category (400)', async () => {
    const response = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'POST', { name: 'Mì Quảng', category: 'trang_mieng', price: 45000 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a non-positive price (400)', async () => {
    const response = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'POST', { name: 'Mì Quảng', category: 'mon_an', price: 0 }), env });
    expect(response.status).toBe(400);
  });

  it('creates a menu item and writes an audit_log row', async () => {
    const response = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'POST', { name: 'Mì Quảng', category: 'mon_an', price: 45000 }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ name: 'Mì Quảng', category: 'mon_an', price: 45000, isActive: true });

    const row = await env.DB.prepare(`SELECT name, category, price, is_active FROM dine_in_menu_items WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ name: 'Mì Quảng', category: 'mon_an', price: 45000, is_active: 1 });

    const auditRow = await env.DB.prepare(`SELECT actor FROM audit_log WHERE action_type = 'dine_in_menu_item_create' AND entity_id = ?`).bind(body.id).first();
    expect(auditRow.actor).toBe('admin_menu');
  });
});

describe('PATCH /api/dine-in-menu/:id', () => {
  let itemId;
  beforeEach(async () => {
    const created = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Trà đá', 'do_uong', 10000, 0, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    itemId = created.meta.last_row_id;
  });

  it('404s for a non-existent id', async () => {
    const response = await patchMenuItem({ request: authedRequest('https://x/api/dine-in-menu/999999', adminToken, 'PATCH', { name: 'x' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects non-admin roles (403)', async () => {
    const response = await patchMenuItem({ request: authedRequest(`https://x/api/dine-in-menu/${itemId}`, managerToken, 'PATCH', { price: 15000 }), env, params: { id: String(itemId) } });
    expect(response.status).toBe(403);
  });

  it('updates name/price/isActive and ignores category, writing an audit_log row', async () => {
    const response = await patchMenuItem({ request: authedRequest(`https://x/api/dine-in-menu/${itemId}`, adminToken, 'PATCH', { name: 'Trà đá lớn', price: 15000, isActive: false, category: 'mon_an' }), env, params: { id: String(itemId) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT name, category, price, is_active FROM dine_in_menu_items WHERE id = ?`).bind(itemId).first();
    expect(row).toEqual({ name: 'Trà đá lớn', category: 'do_uong', price: 15000, is_active: 0 });

    const auditRow = await env.DB.prepare(`SELECT actor FROM audit_log WHERE action_type = 'dine_in_menu_item_update' AND entity_id = ?`).bind(itemId).first();
    expect(auditRow.actor).toBe('admin_menu');
  });
});
