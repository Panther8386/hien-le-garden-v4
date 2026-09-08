import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listBatches, onRequestPost as createBatch } from '../functions/api/asset-inventory-batches/index.js';
import { onRequestGet as getBatch, onRequestPatch as patchBatchStatus } from '../functions/api/asset-inventory-batches/[id].js';
import { onRequestPost as refreshLines } from '../functions/api/asset-inventory-batches/[id]/refresh-lines.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;
let individualCategoryId, bulkCategoryId;
let locationId, inactiveLocationId;
let individualAssetId, bulkAssetId;

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM assets');
  await env.DB.exec('DELETE FROM asset_categories');
  await env.DB.exec('DELETE FROM asset_locations');
  await env.DB.exec('DELETE FROM asset_inventory_lines');
  await env.DB.exec('DELETE FROM asset_inventory_batches');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_ib', 'x', 'manager', '2026-09-08T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_ib', 'x', 'reception', '2026-09-08T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_ib', 'x', 'admin', '2026-09-08T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_ib', 'x', 'observer', '2026-09-08T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const cat1 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('individual_device', 'Điều hoà', 'bộ', 'admin_ib', '2026-09-08T00:00:00Z')`).run();
  individualCategoryId = cat1.meta.last_row_id;
  const cat2 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('durable_goods', 'Giường', 'cái', 'admin_ib', '2026-09-08T00:00:00Z')`).run();
  bulkCategoryId = cat2.meta.last_row_id;

  const loc = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('common_area', 'Sảnh 1', 'admin_ib', '2026-09-08T00:00:00Z')`).run();
  locationId = loc.meta.last_row_id;
  const inactiveLoc = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, is_active, created_by, created_at) VALUES ('common_area', 'Kho cũ', 0, 'admin_ib', '2026-09-08T00:00:00Z')`).run();
  inactiveLocationId = inactiveLoc.meta.last_row_id;

  const ind = await env.DB.prepare(
    `INSERT INTO assets (category_id, name, source_type, location_id, quantity, created_by, created_at) VALUES (?, 'Điều hoà Daikin', 'handover_a', ?, 1, 'admin_ib', '2026-09-08T00:00:00Z')`
  ).bind(individualCategoryId, locationId).run();
  individualAssetId = ind.meta.last_row_id;
  const bulk = await env.DB.prepare(
    `INSERT INTO assets (category_id, name, source_type, location_id, quantity, created_by, created_at) VALUES (?, 'Giường 1.6m', 'handover_a', ?, 4, 'admin_ib', '2026-09-08T00:00:00Z')`
  ).bind(bulkCategoryId, locationId).run();
  bulkAssetId = bulk.meta.last_row_id;
});

describe('POST /api/asset-inventory-batches', () => {
  it('creates a batch and auto-populates one line per asset at the location, snapshotting book_quantity', async () => {
    const response = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const { results } = await env.DB.prepare(`SELECT asset_id, book_quantity FROM asset_inventory_lines WHERE batch_id = ? ORDER BY asset_id`).bind(id).all();
    expect(results).toEqual([
      { asset_id: individualAssetId, book_quantity: 1 },
      { asset_id: bulkAssetId, book_quantity: 4 },
    ]);
  });

  it('defaults the label from the location name and date when none is given', async () => {
    const response = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const { id } = await response.json();
    const row = await env.DB.prepare(`SELECT label FROM asset_inventory_batches WHERE id = ?`).bind(id).first();
    expect(row.label).toContain('Sảnh 1');
  });

  it('excludes a soft-deleted asset from the auto-populated lines', async () => {
    await env.DB.prepare(`UPDATE assets SET is_deleted = 1 WHERE id = ?`).bind(bulkAssetId).run();
    const response = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const { id } = await response.json();
    const { results } = await env.DB.prepare(`SELECT asset_id FROM asset_inventory_lines WHERE batch_id = ?`).bind(id).all();
    expect(results).toEqual([{ asset_id: individualAssetId }]);
  });

  it('rejects an inactive location (400)', async () => {
    const response = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId: inactiveLocationId }), env });
    expect(response.status).toBe(400);
  });

  it('rejects reception (403)', async () => {
    const response = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', receptionToken, 'POST', { locationId }), env });
    expect(response.status).toBe(403);
  });
});

describe('GET /api/asset-inventory-batches', () => {
  it('filters by locationId and status', async () => {
    await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const other = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('common_area', 'Sảnh 2', 'admin_ib', '2026-09-08T00:00:00Z')`).run();
    await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId: other.meta.last_row_id }), env });

    const response = await listBatches({ request: authedRequest(`https://x/api/asset-inventory-batches?locationId=${locationId}`, observerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].locationId).toBe(locationId);
    expect(body[0].status).toBe('draft');
  });
});

describe('GET /api/asset-inventory-batches/:id', () => {
  it('returns the batch with its lines joined to asset info', async () => {
    const created = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const { id } = await created.json();

    const response = await getBatch({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, observerToken, 'GET'), env, params: { id: String(id) } });
    const body = await response.json();
    expect(body.status).toBe('draft');
    expect(body.lines).toHaveLength(2);
    const indLine = body.lines.find((l) => l.assetId === individualAssetId);
    expect(indLine.managementType).toBe('individual_device');
    expect(indLine.assetName).toBe('Điều hoà Daikin');
    expect(indLine.bookQuantity).toBe(1);
    expect(indLine.actualQuantity).toBeNull();
  });

  it('404s for a nonexistent batch', async () => {
    const response = await getBatch({ request: authedRequest('https://x/api/asset-inventory-batches/999999', adminToken, 'GET'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/asset-inventory-batches/:id -- status transitions', () => {
  async function makeBatch() {
    const created = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    return (await created.json()).id;
  }

  it('lets a manager move draft -> counting', async () => {
    const id = await makeBatch();
    const response = await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, managerToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT status FROM asset_inventory_batches WHERE id = ?`).bind(id).first();
    expect(row.status).toBe('counting');
  });

  it('rejects reception moving draft -> counting (403)', async () => {
    const id = await makeBatch();
    const response = await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, receptionToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    expect(response.status).toBe(403);
  });

  it('lets reception move counting -> pending_close', async () => {
    const id = await makeBatch();
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    const response = await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, receptionToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(id) } });
    expect(response.status).toBe(200);
  });

  it('rejects reception moving pending_close -> closed (403)', async () => {
    const id = await makeBatch();
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(id) } });
    const response = await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, receptionToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });
    expect(response.status).toBe(403);
  });

  it('rejects skipping a state (draft -> pending_close, 400)', async () => {
    const id = await makeBatch();
    const response = await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(id) } });
    expect(response.status).toBe(400);
  });

  it('rejects any transition once closed (terminal)', async () => {
    const id = await makeBatch();
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(id) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });
    const response = await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    expect(response.status).toBe(400);
  });
});

describe('PATCH .../status {closed} -- closing-time reconciliation', () => {
  async function makeCountingBatch() {
    const created = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const { id } = await created.json();
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(id) } });
    return id;
  }

  it('updates a bulk asset quantity and writes asset_inventory_adjustment when actual differs from book', async () => {
    const id = await makeCountingBatch();
    await env.DB.prepare(`UPDATE asset_inventory_lines SET actual_quantity = 3 WHERE batch_id = ? AND asset_id = ?`).bind(id, bulkAssetId).run();

    const response = await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });
    expect(response.status).toBe(200);

    const asset = await env.DB.prepare(`SELECT quantity FROM assets WHERE id = ?`).bind(bulkAssetId).first();
    expect(asset.quantity).toBe(3);

    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_inventory_adjustment' AND entity_id = ?`).bind(bulkAssetId).first();
    expect(audit.old_value).toBe('4');
    expect(audit.new_value).toBe('3');
  });

  it('never changes quantity, location, or lifecycle for an individual asset, even when actual_quantity is 0', async () => {
    const id = await makeCountingBatch();
    await env.DB.prepare(`UPDATE asset_inventory_lines SET actual_quantity = 0 WHERE batch_id = ? AND asset_id = ?`).bind(id, individualAssetId).run();

    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });

    const asset = await env.DB.prepare(`SELECT quantity, location_id, lifecycle_status FROM assets WHERE id = ?`).bind(individualAssetId).first();
    expect(asset.quantity).toBe(1);
    expect(asset.location_id).toBe(locationId);
    expect(asset.lifecycle_status).toBe('dang_quan_ly');
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_inventory_adjustment' AND entity_id = ?`).bind(individualAssetId).first();
    expect(audit).toBeNull();
  });

  it('skips a line whose actual_quantity was never set (NULL), writing no adjustment', async () => {
    const id = await makeCountingBatch();
    // bulkAssetId's line is left untouched -- actual_quantity stays NULL

    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });

    const asset = await env.DB.prepare(`SELECT quantity FROM assets WHERE id = ?`).bind(bulkAssetId).first();
    expect(asset.quantity).toBe(4);
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_inventory_adjustment' AND entity_id = ?`).bind(bulkAssetId).first();
    expect(audit).toBeNull();
  });

  it('does not write an adjustment when actual_quantity equals book_quantity', async () => {
    const id = await makeCountingBatch();
    await env.DB.prepare(`UPDATE asset_inventory_lines SET actual_quantity = 4 WHERE batch_id = ? AND asset_id = ?`).bind(id, bulkAssetId).run();

    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });

    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_inventory_adjustment' AND entity_id = ?`).bind(bulkAssetId).first();
    expect(audit).toBeNull();
  });

  it('stamps closed_by and closed_at on the batch', async () => {
    const id = await makeCountingBatch();
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });
    const row = await env.DB.prepare(`SELECT closed_by, closed_at FROM asset_inventory_batches WHERE id = ?`).bind(id).first();
    expect(row.closed_by).toBe('admin_ib');
    expect(row.closed_at).not.toBeNull();
  });
});

describe('POST /api/asset-inventory-batches/:id/refresh-lines', () => {
  it('adds a line for an asset that moved into the location after batch creation, without touching existing lines', async () => {
    const created = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const { id } = await created.json();
    await env.DB.prepare(`UPDATE asset_inventory_lines SET actual_quantity = 4 WHERE batch_id = ? AND asset_id = ?`).bind(id, bulkAssetId).run();

    const newAsset = await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, location_id, quantity, created_by, created_at) VALUES (?, 'Ghế mới', 'purchased_b', ?, 2, 'admin_ib', '2026-09-08T00:00:00Z')`
    ).bind(bulkCategoryId, locationId).run();

    const response = await refreshLines({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}/refresh-lines`, adminToken, 'POST'), env, params: { id: String(id) } });
    expect(response.status).toBe(200);
    const { addedCount } = await response.json();
    expect(addedCount).toBe(1);

    const { results } = await env.DB.prepare(`SELECT asset_id, actual_quantity FROM asset_inventory_lines WHERE batch_id = ? ORDER BY asset_id`).bind(id).all();
    expect(results).toEqual([
      { asset_id: individualAssetId, actual_quantity: null },
      { asset_id: bulkAssetId, actual_quantity: 4 },
      { asset_id: newAsset.meta.last_row_id, actual_quantity: null },
    ]);
  });

  it('rejects refreshing a closed batch (400)', async () => {
    const created = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const { id } = await created.json();
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'counting' }), env, params: { id: String(id) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(id) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(id) } });

    const response = await refreshLines({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}/refresh-lines`, adminToken, 'POST'), env, params: { id: String(id) } });
    expect(response.status).toBe(400);
  });

  it('rejects reception (403)', async () => {
    const created = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
    const { id } = await created.json();
    const response = await refreshLines({ request: authedRequest(`https://x/api/asset-inventory-batches/${id}/refresh-lines`, receptionToken, 'POST'), env, params: { id: String(id) } });
    expect(response.status).toBe(403);
  });
});
