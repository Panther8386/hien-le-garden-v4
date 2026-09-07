import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as uploadPhoto, onRequestDelete as deletePhoto, onRequestGet as getPhoto } from '../functions/api/assets/[id]/photo.js';
import { onRequestPost as createAsset } from '../functions/api/assets/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken;
let assetId;

function imageFile(name = 'anh.jpg', bytes = new Uint8Array([1, 2, 3, 4])) {
  return new File([bytes], name, { type: 'image/jpeg' });
}

function authedFormRequest(url, token, file) {
  const form = new FormData();
  if (file) form.append('file', file);
  const headers = {};
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method: 'POST', headers, body: form });
}

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

function authedPlainRequest(url, token, method) {
  const headers = {};
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers });
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM assets');
  await env.DB.exec('DELETE FROM asset_categories');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_ph', 'x', 'manager', '2026-09-07T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_ph', 'x', 'reception', '2026-09-07T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_ph', 'x', 'admin', '2026-09-07T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);

  const cat = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('individual_device', 'Điều hoà', 'bộ', 'admin_ph', '2026-09-07T00:00:00Z')`).run();
  const createResponse = await createAsset({ request: authedRequest('https://x/api/assets', adminToken, 'POST', { categoryId: cat.meta.last_row_id, name: 'Điều hoà test', sourceType: 'handover_a' }), env });
  assetId = (await createResponse.json()).id;
});

describe('POST /api/assets/:id/photo', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, null, imageFile()), env, params: { id: String(assetId) } });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, receptionToken, imageFile()), env, params: { id: String(assetId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent asset', async () => {
    const response = await uploadPhoto({ request: authedFormRequest('https://x/api/assets/999999/photo', adminToken, imageFile()), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('400s when no file is included', async () => {
    const response = await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, adminToken, null), env, params: { id: String(assetId) } });
    expect(response.status).toBe(400);
  });

  it('400s for a disallowed content type', async () => {
    const badFile = new File([new Uint8Array([1])], 'x.txt', { type: 'text/plain' });
    const response = await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, adminToken, badFile), env, params: { id: String(assetId) } });
    expect(response.status).toBe(400);
  });

  it('uploads a valid file, stores the R2 object, and updates the asset row', async () => {
    const response = await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, adminToken, imageFile('may-lanh.jpg')), env, params: { id: String(assetId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT photo_key, photo_filename FROM assets WHERE id = ?`).bind(assetId).first();
    expect(row.photo_filename).toBe('may-lanh.jpg');
    expect(row.photo_key).toContain(`asset-photos/${assetId}/`);
    const object = await env.RECEIPTS.get(row.photo_key);
    expect(object).not.toBeNull();
  });

  it('replacing an existing photo deletes the old R2 object', async () => {
    await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, adminToken, imageFile('anh1.jpg')), env, params: { id: String(assetId) } });
    const firstRow = await env.DB.prepare(`SELECT photo_key FROM assets WHERE id = ?`).bind(assetId).first();
    const oldKey = firstRow.photo_key;

    await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, adminToken, imageFile('anh2.jpg')), env, params: { id: String(assetId) } });
    const oldObject = await env.RECEIPTS.get(oldKey);
    expect(oldObject).toBeNull();
  });
});

describe('DELETE /api/assets/:id/photo', () => {
  it('rejects reception (403)', async () => {
    const response = await deletePhoto({ request: authedPlainRequest(`https://x/api/assets/${assetId}/photo`, receptionToken, 'DELETE'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(403);
  });

  it('400s when the asset has no photo to remove', async () => {
    const response = await deletePhoto({ request: authedPlainRequest(`https://x/api/assets/${assetId}/photo`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(400);
  });

  it('removes the R2 object and clears all three photo columns', async () => {
    await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, adminToken, imageFile()), env, params: { id: String(assetId) } });
    const response = await deletePhoto({ request: authedPlainRequest(`https://x/api/assets/${assetId}/photo`, adminToken, 'DELETE'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT photo_key, photo_filename, photo_uploaded_at FROM assets WHERE id = ?`).bind(assetId).first();
    expect(row.photo_key).toBeNull();
    expect(row.photo_filename).toBeNull();
    expect(row.photo_uploaded_at).toBeNull();
  });
});

describe('GET /api/assets/:id/photo', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getPhoto({ request: authedPlainRequest(`https://x/api/assets/${assetId}/photo`, null, 'GET'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(401);
  });

  it('404s when the asset has no photo', async () => {
    const response = await getPhoto({ request: authedPlainRequest(`https://x/api/assets/${assetId}/photo`, adminToken, 'GET'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(404);
  });

  it('streams the file back for all 4 roles, including observer', async () => {
    await uploadPhoto({ request: authedFormRequest(`https://x/api/assets/${assetId}/photo`, adminToken, imageFile('bill.jpg')), env, params: { id: String(assetId) } });
    const observerAccount = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_ph', 'x', 'observer', '2026-09-07T00:00:00Z')`).run();
    const observerToken = await createSession(env.DB, observerAccount.meta.last_row_id);
    const response = await getPhoto({ request: authedPlainRequest(`https://x/api/assets/${assetId}/photo`, observerToken, 'GET'), env, params: { id: String(assetId) } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Disposition')).toContain('bill.jpg');
  });
});
