import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listLots, onRequestPost as createLot } from '../functions/api/asset-inventory-food-lots/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, adminToken;
let foodCategoryId, linenCategoryId;
let locationId;

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM asset_categories');
  await env.DB.exec('DELETE FROM asset_locations');
  await env.DB.exec('DELETE FROM asset_inventory_food_lots');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_fl', 'x', 'manager', '2026-09-09T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_fl', 'x', 'admin', '2026-09-09T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);

  const cat1 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('food_beverage', 'Tôm đông lạnh', 'kg', 'admin_fl', '2026-09-09T00:00:00Z')`).run();
  foodCategoryId = cat1.meta.last_row_id;
  const cat2 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('linen', 'Khăn tắm', 'cái', 'admin_fl', '2026-09-09T00:00:00Z')`).run();
  linenCategoryId = cat2.meta.last_row_id;

  const loc = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('warehouse', 'TP - Tủ đông', 'admin_fl', '2026-09-09T00:00:00Z')`).run();
  locationId = loc.meta.last_row_id;
});

describe('GET /api/asset-inventory-food-lots', () => {
  it('sorts by expiry_date ascending, nulls last', async () => {
    await env.DB.prepare(`INSERT INTO asset_inventory_food_lots (category_id, location_id, expiry_date, created_by, created_at) VALUES (?, ?, NULL, 'admin_fl', '2026-09-09T00:00:00Z')`).bind(foodCategoryId, locationId).run();
    await env.DB.prepare(`INSERT INTO asset_inventory_food_lots (category_id, location_id, expiry_date, created_by, created_at) VALUES (?, ?, '2026-09-20', 'admin_fl', '2026-09-09T00:00:00Z')`).bind(foodCategoryId, locationId).run();
    await env.DB.prepare(`INSERT INTO asset_inventory_food_lots (category_id, location_id, expiry_date, created_by, created_at) VALUES (?, ?, '2026-09-12', 'admin_fl', '2026-09-09T00:00:00Z')`).bind(foodCategoryId, locationId).run();

    const response = await listLots({ request: authedRequest('https://x/api/asset-inventory-food-lots', managerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.map((l) => l.expiryDate)).toEqual(['2026-09-12', '2026-09-20', null]);
  });

  it('filters by categoryId and locationId', async () => {
    await env.DB.prepare(`INSERT INTO asset_inventory_food_lots (category_id, location_id, created_by, created_at) VALUES (?, ?, 'admin_fl', '2026-09-09T00:00:00Z')`).bind(foodCategoryId, locationId).run();
    const response = await listLots({ request: authedRequest(`https://x/api/asset-inventory-food-lots?categoryId=${foodCategoryId}&locationId=${locationId}`, managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await listLots({ request: new Request('https://x/api/asset-inventory-food-lots'), env });
    expect(response.status).toBe(401);
  });

  it('filters to lots expiring within N days when expiringWithinDays is set', async () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await env.DB.prepare(`INSERT INTO asset_inventory_food_lots (category_id, location_id, expiry_date, created_by, created_at) VALUES (?, ?, ?, 'admin_fl', '2026-09-09T00:00:00Z')`).bind(foodCategoryId, locationId, soon).run();
    await env.DB.prepare(`INSERT INTO asset_inventory_food_lots (category_id, location_id, expiry_date, created_by, created_at) VALUES (?, ?, ?, 'admin_fl', '2026-09-09T00:00:00Z')`).bind(foodCategoryId, locationId, far).run();
    await env.DB.prepare(`INSERT INTO asset_inventory_food_lots (category_id, location_id, expiry_date, created_by, created_at) VALUES (?, ?, NULL, 'admin_fl', '2026-09-09T00:00:00Z')`).bind(foodCategoryId, locationId).run();

    const response = await listLots({ request: authedRequest('https://x/api/asset-inventory-food-lots?expiringWithinDays=7', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].expiryDate).toBe(soon);
  });
});

describe('POST /api/asset-inventory-food-lots', () => {
  it('lets an admin create a lot', async () => {
    const response = await createLot({
      request: authedRequest('https://x/api/asset-inventory-food-lots', adminToken, 'POST', { categoryId: foodCategoryId, locationId, receivedDate: '2026-09-09', expiryDate: '2026-09-16', note: 'Lô sáng' }),
      env,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT expiry_date, note FROM asset_inventory_food_lots WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ expiry_date: '2026-09-16', note: 'Lô sáng' });
  });

  it('allows omitting receivedDate/expiryDate (unknown, not guessed)', async () => {
    const response = await createLot({
      request: authedRequest('https://x/api/asset-inventory-food-lots', adminToken, 'POST', { categoryId: foodCategoryId, locationId }),
      env,
    });
    expect(response.status).toBe(201);
  });

  it('rejects a category that is not food_beverage', async () => {
    const response = await createLot({
      request: authedRequest('https://x/api/asset-inventory-food-lots', adminToken, 'POST', { categoryId: linenCategoryId, locationId }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-admin (403)', async () => {
    const response = await createLot({
      request: authedRequest('https://x/api/asset-inventory-food-lots', managerToken, 'POST', { categoryId: foodCategoryId, locationId }),
      env,
    });
    expect(response.status).toBe(403);
  });

  it('returns 404 for an unknown category', async () => {
    const response = await createLot({
      request: authedRequest('https://x/api/asset-inventory-food-lots', adminToken, 'POST', { categoryId: 999999, locationId }),
      env,
    });
    expect(response.status).toBe(404);
  });
});
