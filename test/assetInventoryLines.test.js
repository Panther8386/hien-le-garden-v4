import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPatch as patchLine } from '../functions/api/asset-inventory-lines/[id].js';
import { onRequestPost as uploadPhoto, onRequestGet as getPhoto, onRequestDelete as deletePhoto } from '../functions/api/asset-inventory-lines/[id]/photo.js';
import { onRequestGet as missingDevices } from '../functions/api/asset-inventory-lines/missing-devices.js';
import { onRequestPost as createBatch } from '../functions/api/asset-inventory-batches/index.js';
import { onRequestPatch as patchBatchStatus } from '../functions/api/asset-inventory-batches/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken;
let individualCategoryId;
let locationId;
let assetId;
let lineId;
let batchId;

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

function uploadRequest(url, token, file) {
  const form = new FormData();
  form.append('file', file);
  const headers = {};
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method: 'POST', headers, body: form });
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

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_il', 'x', 'manager', '2026-09-08T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_il', 'x', 'reception', '2026-09-08T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_il', 'x', 'admin', '2026-09-08T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);

  const cat = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('individual_device', 'Điều hoà', 'bộ', 'admin_il', '2026-09-08T00:00:00Z')`).run();
  individualCategoryId = cat.meta.last_row_id;

  const loc = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('common_area', 'Sảnh 1', 'admin_il', '2026-09-08T00:00:00Z')`).run();
  locationId = loc.meta.last_row_id;

  const asset = await env.DB.prepare(
    `INSERT INTO assets (category_id, name, internal_code, source_type, location_id, quantity, created_by, created_at) VALUES (?, 'Điều hoà Daikin', 'TS000001', 'handover_a', ?, 1, 'admin_il', '2026-09-08T00:00:00Z')`
  ).bind(individualCategoryId, locationId).run();
  assetId = asset.meta.last_row_id;

  const batch = await createBatch({ request: authedRequest('https://x/api/asset-inventory-batches', adminToken, 'POST', { locationId }), env });
  batchId = (await batch.json()).id;
  const line = await env.DB.prepare(`SELECT id FROM asset_inventory_lines WHERE batch_id = ? AND asset_id = ?`).bind(batchId, assetId).first();
  lineId = line.id;
});

async function moveBatchTo(status) {
  const chain = ['counting', 'pending_close', 'closed'];
  const targetIndex = chain.indexOf(status);
  for (let i = 0; i <= targetIndex; i++) {
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${batchId}`, adminToken, 'PATCH', { status: chain[i] }), env, params: { id: String(batchId) } });
  }
}

describe('PATCH /api/asset-inventory-lines/:id', () => {
  it('lets reception fill in a line while the batch is counting', async () => {
    await moveBatchTo('counting');
    const response = await patchLine({
      request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}`, receptionToken, 'PATCH', { actualQuantity: 1, conditionFound: 'tot', note: 'Đủ', suggestedAction: '' }),
      env,
      params: { id: String(lineId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT actual_quantity, condition_found, note FROM asset_inventory_lines WHERE id = ?`).bind(lineId).first();
    expect(row).toEqual({ actual_quantity: 1, condition_found: 'tot', note: 'Đủ' });
  });

  it('rejects reception once the batch is pending_close (400)', async () => {
    await moveBatchTo('pending_close');
    const response = await patchLine({
      request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}`, receptionToken, 'PATCH', { actualQuantity: 1 }),
      env,
      params: { id: String(lineId) },
    });
    expect(response.status).toBe(400);
  });

  it('lets a manager fill in a line while pending_close', async () => {
    await moveBatchTo('pending_close');
    const response = await patchLine({
      request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}`, managerToken, 'PATCH', { actualQuantity: 0 }),
      env,
      params: { id: String(lineId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects any edit once the batch is closed (400)', async () => {
    await moveBatchTo('closed');
    const response = await patchLine({
      request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}`, adminToken, 'PATCH', { actualQuantity: 1 }),
      env,
      params: { id: String(lineId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects an edit while the batch is still draft, even for admin (400)', async () => {
    // No moveBatchTo() call -- the batch created in beforeEach starts in draft
    // and counting hasn't been started yet, so canWriteLine() falls through
    // to its default `false` regardless of role.
    const response = await patchLine({
      request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}`, adminToken, 'PATCH', { actualQuantity: 1 }),
      env,
      params: { id: String(lineId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a negative actualQuantity (400)', async () => {
    await moveBatchTo('counting');
    const response = await patchLine({
      request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}`, adminToken, 'PATCH', { actualQuantity: -1 }),
      env,
      params: { id: String(lineId) },
    });
    expect(response.status).toBe(400);
  });

  it('404s for a nonexistent line', async () => {
    const response = await patchLine({ request: authedRequest('https://x/api/asset-inventory-lines/999999', adminToken, 'PATCH', { actualQuantity: 1 }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });
});

describe('POST/GET/DELETE /api/asset-inventory-lines/:id/photo', () => {
  it('uploads a photo while counting and it can be read back', async () => {
    await moveBatchTo('counting');
    const file = new File(['fake-image-bytes'], 'thiet-bi.jpg', { type: 'image/jpeg' });
    const uploadResponse = await uploadPhoto({ request: uploadRequest(`https://x/api/asset-inventory-lines/${lineId}/photo`, receptionToken, file), env, params: { id: String(lineId) } });
    expect(uploadResponse.status).toBe(200);

    const row = await env.DB.prepare(`SELECT photo_key, photo_filename FROM asset_inventory_lines WHERE id = ?`).bind(lineId).first();
    expect(row.photo_filename).toBe('thiet-bi.jpg');
    expect(row.photo_key).toContain(`inventory-line-photos/${lineId}/`);

    const getResponse = await getPhoto({ request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}/photo`, adminToken, 'GET'), env, params: { id: String(lineId) } });
    expect(getResponse.status).toBe(200);
  });

  it('rejects an upload once the batch is closed (400)', async () => {
    await moveBatchTo('closed');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const response = await uploadPhoto({ request: uploadRequest(`https://x/api/asset-inventory-lines/${lineId}/photo`, adminToken, file), env, params: { id: String(lineId) } });
    expect(response.status).toBe(400);
  });

  it('deletes a photo and clears all 3 columns', async () => {
    await moveBatchTo('counting');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await uploadPhoto({ request: uploadRequest(`https://x/api/asset-inventory-lines/${lineId}/photo`, adminToken, file), env, params: { id: String(lineId) } });

    const response = await deletePhoto({ request: authedRequest(`https://x/api/asset-inventory-lines/${lineId}/photo`, adminToken, 'DELETE'), env, params: { id: String(lineId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT photo_key, photo_filename, photo_uploaded_at FROM asset_inventory_lines WHERE id = ?`).bind(lineId).first();
    expect(row).toEqual({ photo_key: null, photo_filename: null, photo_uploaded_at: null });
  });
});

describe('GET /api/asset-inventory-lines/missing-devices', () => {
  it('lists an individual asset line only once the batch is closed and actual_quantity is 0', async () => {
    await moveBatchTo('counting');
    await env.DB.prepare(`UPDATE asset_inventory_lines SET actual_quantity = 0 WHERE id = ?`).bind(lineId).run();

    const beforeClose = await missingDevices({ request: authedRequest('https://x/api/asset-inventory-lines/missing-devices', receptionToken, 'GET'), env });
    expect(await beforeClose.json()).toEqual([]);

    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${batchId}`, adminToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(batchId) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${batchId}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(batchId) } });

    const afterClose = await missingDevices({ request: authedRequest('https://x/api/asset-inventory-lines/missing-devices', receptionToken, 'GET'), env });
    const body = await afterClose.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ assetId, assetName: 'Điều hoà Daikin', internalCode: 'TS000001', locationId, batchId });
  });

  it('never lists a line whose actual_quantity is 1 (found)', async () => {
    await moveBatchTo('counting');
    await env.DB.prepare(`UPDATE asset_inventory_lines SET actual_quantity = 1 WHERE id = ?`).bind(lineId).run();
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${batchId}`, adminToken, 'PATCH', { status: 'pending_close' }), env, params: { id: String(batchId) } });
    await patchBatchStatus({ request: authedRequest(`https://x/api/asset-inventory-batches/${batchId}`, adminToken, 'PATCH', { status: 'closed' }), env, params: { id: String(batchId) } });

    const response = await missingDevices({ request: authedRequest('https://x/api/asset-inventory-lines/missing-devices', receptionToken, 'GET'), env });
    expect(await response.json()).toEqual([]);
  });
});
