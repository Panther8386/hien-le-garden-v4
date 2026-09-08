import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listAssets, onRequestPost as createAsset } from '../functions/api/assets/index.js';
import { onRequestPatch as patchAsset, onRequestDelete as deleteAsset } from '../functions/api/assets/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;
let individualCategoryId, bulkCategoryId, locationId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM assets');
  await env.DB.exec('DELETE FROM asset_categories');
  await env.DB.exec('DELETE FROM asset_locations');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_as', 'x', 'manager', '2026-09-07T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_as', 'x', 'reception', '2026-09-07T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_as', 'x', 'admin', '2026-09-07T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_as', 'x', 'observer', '2026-09-07T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const cat1 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('individual_device', 'Điều hoà', 'bộ', 'admin_as', '2026-09-07T00:00:00Z')`).run();
  individualCategoryId = cat1.meta.last_row_id;
  const cat2 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('durable_goods', 'Giường', 'cái', 'admin_as', '2026-09-07T00:00:00Z')`).run();
  bulkCategoryId = cat2.meta.last_row_id;

  const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();
  const loc = await env.DB.prepare(`INSERT INTO asset_locations (location_type, room_id, name, created_by, created_at) VALUES ('room', ?, 'Test Room', 'admin_as', '2026-09-07T00:00:00Z')`).bind(roomRow.id).run();
  locationId = loc.meta.last_row_id;
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/assets', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listAssets({ request: new Request('https://x/api/assets'), env });
    expect(response.status).toBe(401);
  });

  it('lets all 4 roles read', async () => {
    for (const token of [managerToken, receptionToken, adminToken, observerToken]) {
      const response = await listAssets({ request: authedRequest('https://x/api/assets', token, 'GET'), env });
      expect(response.status).toBe(200);
    }
  });

  it('filters by categoryId', async () => {
    await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'Điều hoà A', sourceType: 'handover_a' }), env });
    await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: bulkCategoryId, name: 'Giường A', sourceType: 'handover_a' }), env });
    const response = await listAssets({ request: authedRequest(`https://x/api/assets?categoryId=${individualCategoryId}`, adminToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Điều hoà A');
  });

  it('filters by managementType via the category join', async () => {
    await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'Điều hoà A', sourceType: 'handover_a' }), env });
    await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: bulkCategoryId, name: 'Giường A', sourceType: 'handover_a' }), env });
    const response = await listAssets({ request: authedRequest('https://x/api/assets?managementType=durable_goods', adminToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((a) => a.name)).toEqual(['Giường A']);
  });

  it('searches by name, internalCode, or serialNumber', async () => {
    const createResponse = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'Điều hoà Daikin', sourceType: 'handover_a', serialNumber: 'SN123' }), env });
    const { id } = await createResponse.json();
    const byName = await listAssets({ request: authedRequest('https://x/api/assets?q=daikin', adminToken, 'GET'), env });
    expect(await byName.json()).toHaveLength(1);
    const bySerial = await listAssets({ request: authedRequest('https://x/api/assets?q=SN123', adminToken, 'GET'), env });
    expect(await bySerial.json()).toHaveLength(1);
    const created = await env.DB.prepare(`SELECT internal_code FROM assets WHERE id = ?`).bind(id).first();
    const byCode = await listAssets({ request: authedRequest(`https://x/api/assets?q=${created.internal_code}`, adminToken, 'GET'), env });
    expect(await byCode.json()).toHaveLength(1);
  });
});

describe('POST /api/assets', () => {
  it('rejects reception (403)', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', receptionToken, 'POST', { categoryId: individualCategoryId, name: 'X', sourceType: 'handover_a' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects observer (403)', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', observerToken, 'POST', { categoryId: individualCategoryId, name: 'X', sourceType: 'handover_a' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a missing categoryId (400)', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { name: 'X', sourceType: 'handover_a' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a nonexistent categoryId (400)', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: 999999, name: 'X', sourceType: 'handover_a' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid sourceType (400)', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'X', sourceType: 'invalid' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a nonexistent locationId (400)', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'X', sourceType: 'handover_a', locationId: 999999 }), env });
    expect(response.status).toBe(400);
  });

  it('creates an individual_device asset with an auto-generated internalCode and quantity forced to 1, ignoring a client-supplied quantity', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'Điều hoà A', sourceType: 'handover_a', quantity: 99 }), env });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const row = await env.DB.prepare(`SELECT internal_code, quantity FROM assets WHERE id = ?`).bind(id).first();
    expect(row.internal_code).toBe(`TS${String(id).padStart(6, '0')}`);
    expect(row.quantity).toBe(1);
  });

  it('creates a durable_goods asset with no internalCode, keeping the given quantity', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: bulkCategoryId, name: 'Giường A', sourceType: 'handover_a', quantity: 14 }), env });
    const { id } = await response.json();
    const row = await env.DB.prepare(`SELECT internal_code, quantity FROM assets WHERE id = ?`).bind(id).first();
    expect(row.internal_code).toBeNull();
    expect(row.quantity).toBe(14);
  });

  it('leaves quantity NULL ("Chưa xác định") for a durable_goods asset with no quantity given', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: bulkCategoryId, name: 'Giường B', sourceType: 'handover_a' }), env });
    const { id } = await response.json();
    const row = await env.DB.prepare(`SELECT quantity FROM assets WHERE id = ?`).bind(id).first();
    expect(row.quantity).toBeNull();
  });

  it('leaves locationId NULL ("Chưa phân bổ vị trí") when not given', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'Điều hoà C', sourceType: 'handover_a' }), env });
    const { id } = await response.json();
    const row = await env.DB.prepare(`SELECT location_id FROM assets WHERE id = ?`).bind(id).first();
    expect(row.location_id).toBeNull();
  });

  it('lets manager create too, and writes an audit_log row', async () => {
    const response = await createAsset({ request: authedRequest('https://x/api/assets', managerToken, 'POST', { categoryId: individualCategoryId, name: 'Điều hoà D', sourceType: 'handover_a' }), env });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_create' AND entity_id = ?`).bind(id).first();
    expect(audit.entity_type).toBe('asset');
    expect(audit.entity_label).toBe('Điều hoà D');
    expect(audit.actor).toBe('quan_ly_as');
  });
});

describe('PATCH /api/assets/:id', () => {
  let individualAssetId, bulkAssetId;

  beforeEach(async () => {
    const r1 = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: individualCategoryId, name: 'Điều hoà E', sourceType: 'handover_a' }), env });
    individualAssetId = (await r1.json()).id;
    const r2 = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: bulkCategoryId, name: 'Giường C', sourceType: 'handover_a', quantity: 5 }), env });
    bulkAssetId = (await r2.json()).id;
  });

  it('rejects reception (403)', async () => {
    const response = await patchAsset({ request: authedRequest(`https://x/api/assets/${bulkAssetId}`, receptionToken, 'PATCH', { name: 'X' }), env, params: { id: String(bulkAssetId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await patchAsset({ request: authedRequest('https://x/api/assets/999999', adminToken, 'PATCH', { name: 'X' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an attempt to change categoryId (400)', async () => {
    const response = await patchAsset({ request: authedRequest(`https://x/api/assets/${bulkAssetId}`, adminToken, 'PATCH', { categoryId: individualCategoryId }), env, params: { id: String(bulkAssetId) } });
    expect(response.status).toBe(400);
  });

  it('updates quantity/location for a durable_goods asset', async () => {
    const response = await patchAsset({ request: authedRequest(`https://x/api/assets/${bulkAssetId}`, adminToken, 'PATCH', { quantity: 12, locationId }), env, params: { id: String(bulkAssetId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT quantity, location_id FROM assets WHERE id = ?`).bind(bulkAssetId).first();
    expect(row.quantity).toBe(12);
    expect(row.location_id).toBe(locationId);
  });

  it('keeps quantity forced to 1 for an individual_device asset even if the client tries to change it', async () => {
    const response = await patchAsset({ request: authedRequest(`https://x/api/assets/${individualAssetId}`, adminToken, 'PATCH', { quantity: 5 }), env, params: { id: String(individualAssetId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT quantity FROM assets WHERE id = ?`).bind(individualAssetId).first();
    expect(row.quantity).toBe(1);
  });

  it('rejects an invalid physicalCondition (400)', async () => {
    const response = await patchAsset({ request: authedRequest(`https://x/api/assets/${bulkAssetId}`, adminToken, 'PATCH', { physicalCondition: 'invalid' }), env, params: { id: String(bulkAssetId) } });
    expect(response.status).toBe(400);
  });

  it('writes an audit_log row with old and new name', async () => {
    await patchAsset({ request: authedRequest(`https://x/api/assets/${bulkAssetId}`, adminToken, 'PATCH', { name: 'Giường C - sửa' }), env, params: { id: String(bulkAssetId) } });
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_update' AND entity_id = ?`).bind(bulkAssetId).first();
    expect(audit.old_value).toBe('Giường C');
    expect(audit.new_value).toBe('Giường C - sửa');
  });
});

describe('DELETE /api/assets/:id', () => {
  async function createTestAsset() {
    const response = await createAsset({
      request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: bulkCategoryId, name: 'Test Delete Asset', sourceType: 'handover_a', quantity: 2 }),
      env,
    });
    return (await response.json()).id;
  }

  it('rejects any role without canDeleteAsset (403), including admin', async () => {
    const assetId = await createTestAsset();
    const response = await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(403);
  });

  it('lets any role with canDeleteAsset delete, regardless of role -- reception here', async () => {
    const assetId = await createTestAsset();
    const receptionRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'le_tan_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(receptionRow.id).run();

    const response = await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, receptionToken, 'DELETE'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT is_deleted FROM assets WHERE id = ?`).bind(assetId).first();
    expect(row.is_deleted).toBe(1);
  });

  it('rejects an observer even with canDeleteAsset = 1 (403) -- stale flag from a pre-demotion grant must not survive a demotion', async () => {
    const assetId = await createTestAsset();
    const observerRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'quan_sat_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(observerRow.id).run();

    const response = await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, observerToken, 'DELETE'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(403);
  });

  it('writes an asset_delete audit_log row', async () => {
    const assetId = await createTestAsset();
    const adminRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'admin_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(adminRow.id).run();

    await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_delete' AND entity_id = ?`).bind(assetId).first();
    expect(audit.entity_label).toBe('Test Delete Asset');
    expect(audit.actor).toBe('admin_as');
  });

  it('404s for a nonexistent asset', async () => {
    const adminRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'admin_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(adminRow.id).run();
    const response = await deleteAsset({ request: authedRequest('https://x/api/assets/999999', adminToken, 'DELETE'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('400s when the asset is already deleted', async () => {
    const assetId = await createTestAsset();
    const adminRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'admin_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(adminRow.id).run();
    await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });

    const response = await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(400);
  });

  it('excludes a deleted asset from GET /api/assets by default', async () => {
    const assetId = await createTestAsset();
    const adminRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'admin_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(adminRow.id).run();
    await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });

    const response = await listAssets({ request: authedRequest('https://x/api/assets', adminToken, 'GET'), env });
    const body = await response.json();
    expect(body.find((a) => a.id === assetId)).toBeUndefined();
  });

  it('includeDeleted=1 shows it again for admin/manager but is silently ignored for reception', async () => {
    const assetId = await createTestAsset();
    const adminRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'admin_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(adminRow.id).run();
    await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });

    const asAdmin = await listAssets({ request: authedRequest('https://x/api/assets?includeDeleted=1', adminToken, 'GET'), env });
    expect((await asAdmin.json()).find((a) => a.id === assetId)).toBeDefined();

    const asReception = await listAssets({ request: authedRequest('https://x/api/assets?includeDeleted=1', receptionToken, 'GET'), env });
    expect((await asReception.json()).find((a) => a.id === assetId)).toBeUndefined();
  });

  it('rejects PATCH on a deleted asset (400)', async () => {
    const assetId = await createTestAsset();
    const adminRow = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = 'admin_as'`).first();
    await env.DB.prepare(`UPDATE staff_accounts SET can_delete_asset = 1 WHERE id = ?`).bind(adminRow.id).run();
    await deleteAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });

    const response = await patchAsset({ request: authedRequest(`https://x/api/assets/${assetId}`, adminToken, 'PATCH', { name: 'Renamed' }), env, params: { id: String(assetId) } });
    expect(response.status).toBe(400);
  });
});
