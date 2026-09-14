import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTransactions, onRequestPost as postTransaction } from '../functions/api/asset-inventory-transactions/index.js';
import { onRequestDelete as voidTransaction } from '../functions/api/asset-inventory-transactions/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;
let consumableCategoryId, linenCategoryId, durableGoodsCategoryId, foodCategoryId;
let warehouseAId, warehouseBId;

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function currentStock(categoryId, locationId) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(quantity_delta), 0) AS total FROM asset_inventory_transactions WHERE category_id = ? AND location_id = ? AND voided_at IS NULL`
  ).bind(categoryId, locationId).first();
  return row.total;
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM asset_categories');
  await env.DB.exec('DELETE FROM asset_locations');
  await env.DB.exec('DELETE FROM asset_inventory_transactions');
  await env.DB.exec('DELETE FROM asset_inventory_food_lots');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_it', 'x', 'manager', '2026-09-09T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_it', 'x', 'reception', '2026-09-09T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_it', 'x', 'admin', '2026-09-09T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_it', 'x', 'observer', '2026-09-09T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const cat1 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('consumable', 'Giấy vệ sinh', 'cuộn', 'admin_it', '2026-09-09T00:00:00Z')`).run();
  consumableCategoryId = cat1.meta.last_row_id;
  const cat2 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('linen', 'Khăn mặt', 'cái', 'admin_it', '2026-09-09T00:00:00Z')`).run();
  linenCategoryId = cat2.meta.last_row_id;
  const cat3 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('durable_goods', 'Giường', 'cái', 'admin_it', '2026-09-09T00:00:00Z')`).run();
  durableGoodsCategoryId = cat3.meta.last_row_id;
  const cat4 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('food_beverage', 'Tôm đông lạnh', 'kg', 'admin_it', '2026-09-09T00:00:00Z')`).run();
  foodCategoryId = cat4.meta.last_row_id;

  const locA = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('warehouse', 'BP - Buồng phòng', 'admin_it', '2026-09-09T00:00:00Z')`).run();
  warehouseAId = locA.meta.last_row_id;
  const locB = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('warehouse', 'TB - Thiết bị', 'admin_it', '2026-09-09T00:00:00Z')`).run();
  warehouseBId = locB.meta.last_row_id;
});

describe('POST /api/asset-inventory-transactions — single', () => {
  it('records an opening balance', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 50 }),
      env,
    });
    expect(response.status).toBe(201);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(50);
  });

  it('rejects consuming more than is in stock', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'consume', quantity: 15 }),
      env,
    });
    expect(response.status).toBe(400);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(10);
  });

  it('does not let two concurrent consume requests push stock negative', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    const [r1, r2] = await Promise.all([
      postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'consume', quantity: 7 }), env }),
      postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', receptionToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'consume', quantity: 7 }), env }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 400]);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(3);
  });

  it('rejects a category outside the 4 kho-managed types', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: durableGoodsCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('requires a direction for adjustment', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'adjustment', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('applies adjustment in the requested direction', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'adjustment', quantity: 2, direction: 'decrease' }), env });
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(8);
  });

  it('rejects a reception writing to a category that does not exist', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', receptionToken, 'POST', { action: 'single', categoryId: 999999, locationId: warehouseAId, movementType: 'opening', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(404);
  });

  it('rejects an observer (403)', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', observerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await postTransaction({
      request: new Request('https://x/api/asset-inventory-transactions', { method: 'POST', body: JSON.stringify({ action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 5 }) }),
      env,
    });
    expect(response.status).toBe(401);
  });

  it('accepts a valid lotId for a food_beverage category', async () => {
    const lot = await env.DB.prepare(
      `INSERT INTO asset_inventory_food_lots (category_id, location_id, created_by, created_at) VALUES (?, ?, 'admin_it', '2026-09-09T00:00:00Z')`
    ).bind(foodCategoryId, warehouseAId).run();
    const lotId = lot.meta.last_row_id;

    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: foodCategoryId, locationId: warehouseAId, lotId, movementType: 'opening', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(`SELECT COALESCE(SUM(quantity_delta), 0) AS total FROM asset_inventory_transactions WHERE lot_id = ? AND voided_at IS NULL`).bind(lotId).first();
    expect(row.total).toBe(5);
  });

  it('rejects a lotId on a non-food_beverage category', async () => {
    const lot = await env.DB.prepare(
      `INSERT INTO asset_inventory_food_lots (category_id, location_id, created_by, created_at) VALUES (?, ?, 'admin_it', '2026-09-09T00:00:00Z')`
    ).bind(foodCategoryId, warehouseAId).run();
    const lotId = lot.meta.last_row_id;

    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, lotId, movementType: 'opening', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent lotId', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: foodCategoryId, locationId: warehouseAId, lotId: 999999, movementType: 'opening', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(404);
  });

  it('requires a linenStatus for a linen category', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: linenCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('seeds an initial linen balance at the chosen status, enabling a later transition', async () => {
    const openResponse = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: linenCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10, linenStatus: 'sach' }),
      env,
    });
    expect(openResponse.status).toBe(201);

    const transitionResponse = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', receptionToken, 'POST', { action: 'linenTransition', categoryId: linenCategoryId, locationId: warehouseAId, fromStatus: 'sach', toStatus: 'cap_dung', quantity: 4 }),
      env,
    });
    expect(transitionResponse.status).toBe(201);
    expect(await currentStock(linenCategoryId, warehouseAId)).toBe(10);
  });

  it('rejects a linenStatus on a non-linen category', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10, linenStatus: 'sach' }),
      env,
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/asset-inventory-transactions — transfer', () => {
  it('moves stock from one warehouse to another as a paired write', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 20 }), env });
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', receptionToken, 'POST', { action: 'transfer', categoryId: consumableCategoryId, fromLocationId: warehouseAId, toLocationId: warehouseBId, quantity: 8 }),
      env,
    });
    expect(response.status).toBe(201);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(12);
    expect(await currentStock(consumableCategoryId, warehouseBId)).toBe(8);
  });

  it('rejects a transfer that would push the source negative', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 5 }), env });
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'transfer', categoryId: consumableCategoryId, fromLocationId: warehouseAId, toLocationId: warehouseBId, quantity: 9 }),
      env,
    });
    expect(response.status).toBe(400);
    expect(await currentStock(consumableCategoryId, warehouseBId)).toBe(0);
  });

  it('rejects the same location for source and destination', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'transfer', categoryId: consumableCategoryId, fromLocationId: warehouseAId, toLocationId: warehouseAId, quantity: 1 }),
      env,
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/asset-inventory-transactions — linenTransition', () => {
  it('moves quantity between statuses without changing the total', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: linenCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 20 }), env });
    // opening lands with no linen_status by default via 'single' — seed directly at 'sach' for a clean starting point instead
    await env.DB.exec('DELETE FROM asset_inventory_transactions');
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, linen_status, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'opening', 'sach', 20, 'cái', 'admin_it', '2026-09-09T00:00:00Z')`
    ).bind(linenCategoryId, warehouseAId).run();

    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', receptionToken, 'POST', { action: 'linenTransition', categoryId: linenCategoryId, locationId: warehouseAId, fromStatus: 'sach', toStatus: 'cap_dung', quantity: 6 }),
      env,
    });
    expect(response.status).toBe(201);
    expect(await currentStock(linenCategoryId, warehouseAId)).toBe(20); // total unchanged

    const { results } = await env.DB.prepare(
      `SELECT linen_status, SUM(quantity_delta) AS total FROM asset_inventory_transactions WHERE category_id = ? AND location_id = ? AND voided_at IS NULL GROUP BY linen_status`
    ).bind(linenCategoryId, warehouseAId).all();
    const byStatus = Object.fromEntries(results.map((r) => [r.linen_status, r.total]));
    expect(byStatus.sach).toBe(14);
    expect(byStatus.cap_dung).toBe(6);
  });

  it('rejects a transition that is not one of the 4 valid pairs', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'linenTransition', categoryId: linenCategoryId, locationId: warehouseAId, fromStatus: 'sach', toStatus: 'dang_giat', quantity: 1 }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a linenTransition on a non-linen category', async () => {
    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'linenTransition', categoryId: consumableCategoryId, locationId: warehouseAId, fromStatus: 'sach', toStatus: 'cap_dung', quantity: 1 }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a linen transition that would push the source status negative', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, linen_status, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'opening', 'sach', 3, 'cái', 'admin_it', '2026-09-09T00:00:00Z')`
    ).bind(linenCategoryId, warehouseAId).run();

    const response = await postTransaction({
      request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'linenTransition', categoryId: linenCategoryId, locationId: warehouseAId, fromStatus: 'sach', toStatus: 'cap_dung', quantity: 5 }),
      env,
    });
    expect(response.status).toBe(400);

    const row = await env.DB.prepare(`SELECT COALESCE(SUM(quantity_delta), 0) AS total FROM asset_inventory_transactions WHERE category_id = ? AND location_id = ? AND linen_status = 'cap_dung' AND voided_at IS NULL`).bind(linenCategoryId, warehouseAId).first();
    expect(row.total).toBe(0); // the paired positive row must never have been written
  });
});

describe('GET /api/asset-inventory-transactions', () => {
  it('lists transactions newest first, filterable by category/location/movementType', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'consume', quantity: 2 }), env });

    const response = await listTransactions({ request: authedRequest('https://x/api/asset-inventory-transactions?movementType=consume', managerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].movementType).toBe('consume');
  });

  it('filters by categoryId and locationId', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 5 }), env });
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: linenCategoryId, locationId: warehouseBId, movementType: 'opening', quantity: 5 }), env });

    const response = await listTransactions({ request: authedRequest(`https://x/api/asset-inventory-transactions?categoryId=${consumableCategoryId}&locationId=${warehouseAId}`, managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].categoryId).toBe(consumableCategoryId);
  });
});

describe('DELETE /api/asset-inventory-transactions/:id (void)', () => {
  it('voids a transaction, removing it from the stock sum', async () => {
    const post = await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    const listResponse = await listTransactions({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'GET'), env });
    const [{ id }] = await listResponse.json();

    const response = await voidTransaction({ request: authedRequest(`https://x/api/asset-inventory-transactions/${id}`, receptionToken, 'DELETE'), env, params: { id: String(id) } });
    expect(response.status).toBe(200);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(0);

    const row = await env.DB.prepare(`SELECT voided_by, voided_at FROM asset_inventory_transactions WHERE id = ?`).bind(id).first();
    expect(row.voided_by).toBe('le_tan_it');
    expect(row.voided_at).not.toBeNull();
  });

  it('rejects voiding an already-voided transaction', async () => {
    const post = await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    const listResponse = await listTransactions({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'GET'), env });
    const [{ id }] = await listResponse.json();

    await voidTransaction({ request: authedRequest(`https://x/api/asset-inventory-transactions/${id}`, managerToken, 'DELETE'), env, params: { id: String(id) } });
    const response = await voidTransaction({ request: authedRequest(`https://x/api/asset-inventory-transactions/${id}`, managerToken, 'DELETE'), env, params: { id: String(id) } });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent transaction', async () => {
    const response = await voidTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions/999999', managerToken, 'DELETE'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an observer (403)', async () => {
    const post = await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    const listResponse = await listTransactions({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'GET'), env });
    const [{ id }] = await listResponse.json();
    const response = await voidTransaction({ request: authedRequest(`https://x/api/asset-inventory-transactions/${id}`, observerToken, 'DELETE'), env, params: { id: String(id) } });
    expect(response.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const post = await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    const listResponse = await listTransactions({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'GET'), env });
    const [{ id }] = await listResponse.json();
    const response = await voidTransaction({ request: new Request(`https://x/api/asset-inventory-transactions/${id}`, { method: 'DELETE' }), env, params: { id: String(id) } });
    expect(response.status).toBe(401);
  });
});

describe('DELETE /api/asset-inventory-transactions/:id — pairing and negative-stock guards', () => {
  it('rejects voiding one half of a transfer pair', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 20 }), env });
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'transfer', categoryId: consumableCategoryId, fromLocationId: warehouseAId, toLocationId: warehouseBId, quantity: 8 }), env });

    const listResponse = await listTransactions({ request: authedRequest(`https://x/api/asset-inventory-transactions?movementType=transfer_out`, managerToken, 'GET'), env });
    const [{ id }] = await listResponse.json();

    const response = await voidTransaction({ request: authedRequest(`https://x/api/asset-inventory-transactions/${id}`, managerToken, 'DELETE'), env, params: { id: String(id) } });
    expect(response.status).toBe(400);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(12);
    expect(await currentStock(consumableCategoryId, warehouseBId)).toBe(8);
  });

  it('rejects voiding an inflow that would drive stock negative', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'consume', quantity: 8 }), env });

    const listResponse = await listTransactions({ request: authedRequest(`https://x/api/asset-inventory-transactions?movementType=opening`, managerToken, 'GET'), env });
    const [{ id }] = await listResponse.json();

    const response = await voidTransaction({ request: authedRequest(`https://x/api/asset-inventory-transactions/${id}`, managerToken, 'DELETE'), env, params: { id: String(id) } });
    expect(response.status).toBe(400);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(2);
  });

  it('allows voiding an inflow when it would not drive stock negative', async () => {
    await postTransaction({ request: authedRequest('https://x/api/asset-inventory-transactions', managerToken, 'POST', { action: 'single', categoryId: consumableCategoryId, locationId: warehouseAId, movementType: 'opening', quantity: 10 }), env });

    const listResponse = await listTransactions({ request: authedRequest(`https://x/api/asset-inventory-transactions?movementType=opening`, managerToken, 'GET'), env });
    const [{ id }] = await listResponse.json();

    const response = await voidTransaction({ request: authedRequest(`https://x/api/asset-inventory-transactions/${id}`, receptionToken, 'DELETE'), env, params: { id: String(id) } });
    expect(response.status).toBe(200);
    expect(await currentStock(consumableCategoryId, warehouseAId)).toBe(0);
  });
});
