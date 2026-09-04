import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listMenu, onRequestPost as createMenuItem } from '../functions/api/dine-in-menu/index.js';
import { onRequestPatch as patchMenuItem } from '../functions/api/dine-in-menu/[id].js';
import { onRequestPatch as moveItem } from '../functions/api/dine-in-menu/[id]/move.js';
import { onRequestPost as moveGroup } from '../functions/api/dine-in-menu/move-group.js';
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
      { id: expect.any(Number), name: 'Cà phê đen', category: 'do_uong', price: 25000, subgroup: null, unit: null, requiresPreorder: false, displayOrder: 1, isActive: false, updatedBy: 'system', updatedAt: '2026-09-04T00:00:00Z' },
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

  it('accepts subgroup/unit/requiresPreorder for mon_an, appending at the end of a new subgroup block', async () => {
    const response = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'POST', { name: 'Gà nướng', category: 'mon_an', price: 368000, subgroup: 'Món gà', unit: 'con', requiresPreorder: true }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ subgroup: 'Món gà', unit: 'con', requiresPreorder: true });

    const row = await env.DB.prepare(`SELECT subgroup, unit, requires_preorder FROM dine_in_menu_items WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ subgroup: 'Món gà', unit: 'con', requires_preorder: 1 });
  });

  it('ignores requiresPreorder for do_uong, always storing 0', async () => {
    const response = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'POST', { name: 'Cà phê sữa', category: 'do_uong', price: 25000, requiresPreorder: true }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.requiresPreorder).toBe(false);
    const row = await env.DB.prepare(`SELECT requires_preorder FROM dine_in_menu_items WHERE id = ?`).bind(body.id).first();
    expect(row.requires_preorder).toBe(0);
  });

  it('inserts a second item into the same subgroup block, keeping it contiguous and after the first', async () => {
    const first = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'POST', { name: 'Gỏi hải sản', category: 'mon_an', price: 179000, subgroup: 'Hải sản' }), env });
    const firstBody = await first.json();
    const secondResponse = await createMenuItem({ request: authedRequest('https://x/api/dine-in-menu', adminToken, 'POST', { name: 'Tôm sốt', category: 'mon_an', price: 275000, subgroup: 'Hải sản' }), env });
    const secondBody = await secondResponse.json();

    const firstRow = await env.DB.prepare(`SELECT display_order FROM dine_in_menu_items WHERE id = ?`).bind(firstBody.id).first();
    const secondRow = await env.DB.prepare(`SELECT display_order FROM dine_in_menu_items WHERE id = ?`).bind(secondBody.id).first();
    expect(secondRow.display_order).toBe(firstRow.display_order + 1);
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

  it('accepts subgroup/unit/requiresPreorder updates', async () => {
    const created = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Cá tầm nướng', 'mon_an', 210000, 5, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const response = await patchMenuItem({ request: authedRequest(`https://x/api/dine-in-menu/${created.meta.last_row_id}`, adminToken, 'PATCH', { subgroup: 'Món gà', unit: 'phần', requiresPreorder: true }), env, params: { id: String(created.meta.last_row_id) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT subgroup, unit, requires_preorder FROM dine_in_menu_items WHERE id = ?`).bind(created.meta.last_row_id).first();
    expect(row).toEqual({ subgroup: 'Món gà', unit: 'phần', requires_preorder: 1 });
  });

  it('moving an item to a different subgroup keeps display_order contiguous within the new group', async () => {
    const a = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Món gà 1', 'mon_an', 100000, 'Món gà', 0, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const b = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Hải sản 1', 'mon_an', 100000, 'Hải sản', 1, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const c = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Hải sản 2', 'mon_an', 100000, 'Hải sản', 2, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();

    const response = await patchMenuItem({ request: authedRequest(`https://x/api/dine-in-menu/${a.meta.last_row_id}`, adminToken, 'PATCH', { subgroup: 'Hải sản' }), env, params: { id: String(a.meta.last_row_id) } });
    expect(response.status).toBe(200);

    const { results } = await env.DB.prepare(`SELECT id, subgroup FROM dine_in_menu_items WHERE category = 'mon_an' ORDER BY display_order`).all();
    expect(results).toEqual([
      { id: b.meta.last_row_id, subgroup: 'Hải sản' },
      { id: c.meta.last_row_id, subgroup: 'Hải sản' },
      { id: a.meta.last_row_id, subgroup: 'Hải sản' },
    ]);
  });
});

describe('PATCH /api/dine-in-menu/:id/move', () => {
  let idA, idB, idC, idOther;
  beforeEach(async () => {
    const a = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Hải sản A', 'mon_an', 100000, 'Hải sản', 0, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const b = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Hải sản B', 'mon_an', 100000, 'Hải sản', 1, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const c = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Hải sân C', 'mon_an', 100000, 'Hải sản', 2, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const other = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Món gà D', 'mon_an', 100000, 'Món gà', 3, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    idA = a.meta.last_row_id; idB = b.meta.last_row_id; idC = c.meta.last_row_id; idOther = other.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await moveItem({ request: new Request(`https://x/api/dine-in-menu/${idB}/move`, { method: 'PATCH' }), env, params: { id: String(idB) } });
    expect(response.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    const response = await moveItem({ request: authedRequest(`https://x/api/dine-in-menu/${idB}/move`, managerToken, 'PATCH', { direction: 'up' }), env, params: { id: String(idB) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await moveItem({ request: authedRequest('https://x/api/dine-in-menu/999999/move', adminToken, 'PATCH', { direction: 'up' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an invalid direction (400)', async () => {
    const response = await moveItem({ request: authedRequest(`https://x/api/dine-in-menu/${idB}/move`, adminToken, 'PATCH', { direction: 'sideways' }), env, params: { id: String(idB) } });
    expect(response.status).toBe(400);
  });

  it('swaps display_order with the adjacent same-subgroup item when moving up', async () => {
    const response = await moveItem({ request: authedRequest(`https://x/api/dine-in-menu/${idB}/move`, adminToken, 'PATCH', { direction: 'up' }), env, params: { id: String(idB) } });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT id, display_order FROM dine_in_menu_items WHERE subgroup = 'Hải sản' ORDER BY display_order`).all();
    expect(results.map((r) => r.id)).toEqual([idB, idA, idC]);
  });

  it('does nothing (200, no change) when already at the top of its group', async () => {
    const response = await moveItem({ request: authedRequest(`https://x/api/dine-in-menu/${idA}/move`, adminToken, 'PATCH', { direction: 'up' }), env, params: { id: String(idA) } });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT id FROM dine_in_menu_items WHERE subgroup = 'Hải sản' ORDER BY display_order`).all();
    expect(results.map((r) => r.id)).toEqual([idA, idB, idC]);
  });

  it('does not cross into an item from a different subgroup even when it is the numerically-nearest neighbor', async () => {
    const response = await moveItem({ request: authedRequest(`https://x/api/dine-in-menu/${idC}/move`, adminToken, 'PATCH', { direction: 'down' }), env, params: { id: String(idC) } });
    expect(response.status).toBe(200);
    const otherRow = await env.DB.prepare(`SELECT display_order FROM dine_in_menu_items WHERE id = ?`).bind(idOther).first();
    expect(otherRow.display_order).toBe(3);
  });
});

describe('POST /api/dine-in-menu/move-group', () => {
  let idA1, idA2, idB1, idC1;
  beforeEach(async () => {
    const a1 = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Hải sản A', 'mon_an', 100000, 'Hải sản', 0, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const a2 = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Hải sản B', 'mon_an', 100000, 'Hải sản', 1, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const b1 = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Món gà A', 'mon_an', 100000, 'Món gà', 2, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    const c1 = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Lẩu A', 'mon_an', 100000, 'Lẩu', 3, 1, 'admin_menu', '2026-09-04T00:00:00Z')`).run();
    idA1 = a1.meta.last_row_id; idA2 = a2.meta.last_row_id; idB1 = b1.meta.last_row_id; idC1 = c1.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await moveGroup({ request: new Request('https://x/api/dine-in-menu/move-group', { method: 'POST' }), env });
    expect(response.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    const response = await moveGroup({ request: authedRequest('https://x/api/dine-in-menu/move-group', managerToken, 'POST', { category: 'mon_an', subgroup: 'Món gà', direction: 'up' }), env });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent subgroup', async () => {
    const response = await moveGroup({ request: authedRequest('https://x/api/dine-in-menu/move-group', adminToken, 'POST', { category: 'mon_an', subgroup: 'Không tồn tại', direction: 'up' }), env });
    expect(response.status).toBe(404);
  });

  it('moving "Món gà" up swaps its whole block with "Hải sản", preserving internal order of both', async () => {
    const response = await moveGroup({ request: authedRequest('https://x/api/dine-in-menu/move-group', adminToken, 'POST', { category: 'mon_an', subgroup: 'Món gà', direction: 'up' }), env });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT id, subgroup FROM dine_in_menu_items WHERE category = 'mon_an' ORDER BY display_order`).all();
    expect(results.map((r) => r.id)).toEqual([idB1, idA1, idA2, idC1]);
  });

  it('does nothing (200, no change) when the first group tries to move up', async () => {
    const response = await moveGroup({ request: authedRequest('https://x/api/dine-in-menu/move-group', adminToken, 'POST', { category: 'mon_an', subgroup: 'Hải sản', direction: 'up' }), env });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT id FROM dine_in_menu_items WHERE category = 'mon_an' ORDER BY display_order`).all();
    expect(results.map((r) => r.id)).toEqual([idA1, idA2, idB1, idC1]);
  });
});
