import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getStock } from '../functions/api/asset-inventory-stock/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, observerToken;
let consumableCategoryId, linenCategoryId;
let warehouseLocationId;

function authedRequest(url, token, method) {
  return new Request(url, { method, headers: token ? { Cookie: `session=${token}` } : {} });
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM asset_categories');
  await env.DB.exec('DELETE FROM asset_locations');
  await env.DB.exec('DELETE FROM asset_inventory_transactions');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_is', 'x', 'manager', '2026-09-09T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_is', 'x', 'observer', '2026-09-09T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const cat1 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('consumable', 'Nước rửa chén', 'chai', 'admin', '2026-09-09T00:00:00Z')`).run();
  consumableCategoryId = cat1.meta.last_row_id;
  const cat2 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('linen', 'Khăn tắm', 'cái', 'admin', '2026-09-09T00:00:00Z')`).run();
  linenCategoryId = cat2.meta.last_row_id;

  const loc = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('warehouse', 'BP - Buồng phòng', 'admin', '2026-09-09T00:00:00Z')`).run();
  warehouseLocationId = loc.meta.last_row_id;
});

describe('GET /api/asset-inventory-stock', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getStock({ request: new Request('https://x/api/asset-inventory-stock'), env });
    expect(response.status).toBe(401);
  });

  it('sums quantity_delta across transactions for a category+location', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'opening', 20, 'chai', 'admin', '2026-09-09T00:00:00Z')`
    ).bind(consumableCategoryId, warehouseLocationId).run();
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'consume', -5, 'chai', 'admin', '2026-09-09T00:00:00Z')`
    ).bind(consumableCategoryId, warehouseLocationId).run();

    const response = await getStock({ request: authedRequest('https://x/api/asset-inventory-stock', managerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ categoryId: consumableCategoryId, locationId: warehouseLocationId, quantity: 15, unit: 'chai' });
  });

  it('excludes voided transactions from the sum', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, quantity_delta, unit, created_by, created_at, voided_by, voided_at) VALUES (?, ?, 'opening', 20, 'chai', 'admin', '2026-09-09T00:00:00Z', 'admin', '2026-09-09T01:00:00Z')`
    ).bind(consumableCategoryId, warehouseLocationId).run();

    const response = await getStock({ request: authedRequest('https://x/api/asset-inventory-stock', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(0);
  });

  it('breaks down linen stock by status', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, linen_status, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'opening', 'sach', 10, 'cái', 'admin', '2026-09-09T00:00:00Z')`
    ).bind(linenCategoryId, warehouseLocationId).run();
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, linen_status, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'issue', 'sach', -3, 'cái', 'admin', '2026-09-09T00:00:00Z')`
    ).bind(linenCategoryId, warehouseLocationId).run();
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, linen_status, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'issue', 'cap_dung', 3, 'cái', 'admin', '2026-09-09T00:00:00Z')`
    ).bind(linenCategoryId, warehouseLocationId).run();

    const response = await getStock({ request: authedRequest('https://x/api/asset-inventory-stock', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body[0]).toMatchObject({ quantity: 10, sach: 7, capDung: 3, ban: 0, dangGiat: 0 });
  });

  it('filters by categoryId, locationId, and managementType', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'opening', 5, 'chai', 'admin', '2026-09-09T00:00:00Z')`
    ).bind(consumableCategoryId, warehouseLocationId).run();
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, linen_status, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'opening', 'sach', 8, 'cái', 'admin', '2026-09-09T00:00:00Z')`
    ).bind(linenCategoryId, warehouseLocationId).run();

    const response = await getStock({ request: authedRequest('https://x/api/asset-inventory-stock?managementType=linen', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].categoryId).toBe(linenCategoryId);
  });

  it('lets an observer read', async () => {
    const response = await getStock({ request: authedRequest('https://x/api/asset-inventory-stock', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
  });
});
