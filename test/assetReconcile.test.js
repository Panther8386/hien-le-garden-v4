import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listSourceRows } from '../functions/api/asset-source-rows/index.js';
import { onRequestPost as reconcileRow } from '../functions/api/asset-source-rows/[id]/reconcile.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;
let individualCategoryId, bulkCategoryId;
let knownRowId, unknownRowId, documentId;

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
  await env.DB.exec('DELETE FROM asset_source_rows');
  await env.DB.exec('DELETE FROM asset_source_documents');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_rc', 'x', 'manager', '2026-09-07T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_rc', 'x', 'reception', '2026-09-07T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_rc', 'x', 'admin', '2026-09-07T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_rc', 'x', 'observer', '2026-09-07T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const cat1 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('individual_device', 'Điều hoà', 'bộ', 'admin_rc', '2026-09-07T00:00:00Z')`).run();
  individualCategoryId = cat1.meta.last_row_id;
  const cat2 = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('durable_goods', 'Giường', 'cái', 'admin_rc', '2026-09-07T00:00:00Z')`).run();
  bulkCategoryId = cat2.meta.last_row_id;

  const doc = await env.DB.prepare(`INSERT INTO asset_source_documents (title, created_by, created_at) VALUES ('Test Doc', 'admin_rc', '2026-09-07T00:00:00Z')`).run();
  documentId = doc.meta.last_row_id;
  const knownRow = await env.DB.prepare(
    `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_quantity, created_at) VALUES (?, 'B', 1, 'Điều hoà', '3', '2026-09-07T00:00:00Z')`
  ).bind(documentId).run();
  knownRowId = knownRow.meta.last_row_id;
  const unknownRow = await env.DB.prepare(
    `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, created_at) VALUES (?, 'C', 2, 'Máy bơm', '2026-09-07T00:00:00Z')`
  ).bind(documentId).run();
  unknownRowId = unknownRow.meta.last_row_id;
});

describe('GET /api/asset-source-rows — reconciledCount', () => {
  it('defaults reconciledCount to 0 when no assets reference the row', async () => {
    const response = await listSourceRows({ request: authedRequest(`https://x/api/asset-source-rows?documentId=${documentId}`, adminToken, 'GET'), env });
    const body = await response.json();
    const row = body.find((r) => r.id === knownRowId);
    expect(row.reconciledCount).toBe(0);
  });

  it('sums quantity (not row count) across individual assets created from the row', async () => {
    await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 3 }), env, params: { id: String(knownRowId) } });
    const response = await listSourceRows({ request: authedRequest(`https://x/api/asset-source-rows?documentId=${documentId}`, adminToken, 'GET'), env });
    const body = await response.json();
    expect(body.find((r) => r.id === knownRowId).reconciledCount).toBe(3);
  });

  it('sums quantity across a bulk asset created from the row', async () => {
    await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${unknownRowId}/reconcile`, adminToken, 'POST', { categoryId: bulkCategoryId, quantity: 14 }), env, params: { id: String(unknownRowId) } });
    const response = await listSourceRows({ request: authedRequest(`https://x/api/asset-source-rows?documentId=${documentId}`, adminToken, 'GET'), env });
    const body = await response.json();
    expect(body.find((r) => r.id === unknownRowId).reconciledCount).toBe(14);
  });
});

describe('POST /api/asset-source-rows/:id/reconcile', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await reconcileRow({ request: new Request(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, { method: 'POST' }), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, receptionToken, 'POST', { categoryId: individualCategoryId }), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(403);
  });

  it('rejects observer (403)', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, observerToken, 'POST', { categoryId: individualCategoryId }), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent source row', async () => {
    const response = await reconcileRow({ request: authedRequest('https://x/api/asset-source-rows/999999/reconcile', adminToken, 'POST', { categoryId: individualCategoryId }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('400s for a missing categoryId', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', {}), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(400);
  });

  it('400s for a nonexistent categoryId', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: 999999 }), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(400);
  });

  it('creates `count` individual assets, each with its own internalCode, quantity=1, sourceType=handover_a and sourceRowId set; defaults count to 1', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId }), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(201);
    const { createdIds } = await response.json();
    expect(createdIds).toHaveLength(1);
    const row = await env.DB.prepare(`SELECT internal_code, quantity, source_type, source_row_id FROM assets WHERE id = ?`).bind(createdIds[0]).first();
    expect(row.internal_code).toBe(`TS${String(createdIds[0]).padStart(6, '0')}`);
    expect(row.quantity).toBe(1);
    expect(row.source_type).toBe('handover_a');
    expect(row.source_row_id).toBe(knownRowId);
  });

  it('creates exactly 1 bulk asset with the given quantity when categoryId is durable_goods', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${unknownRowId}/reconcile`, adminToken, 'POST', { categoryId: bulkCategoryId, quantity: 5 }), env, params: { id: String(unknownRowId) } });
    expect(response.status).toBe(201);
    const { createdIds } = await response.json();
    expect(createdIds).toHaveLength(1);
    const row = await env.DB.prepare(`SELECT internal_code, quantity FROM assets WHERE id = ?`).bind(createdIds[0]).first();
    expect(row.internal_code).toBeNull();
    expect(row.quantity).toBe(5);
  });

  it('leaves quantity NULL for a bulk asset when quantity is omitted', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${unknownRowId}/reconcile`, adminToken, 'POST', { categoryId: bulkCategoryId }), env, params: { id: String(unknownRowId) } });
    const { createdIds } = await response.json();
    const row = await env.DB.prepare(`SELECT quantity FROM assets WHERE id = ?`).bind(createdIds[0]).first();
    expect(row.quantity).toBeNull();
  });

  it('blocks reconciling past a known raw_quantity (individual case)', async () => {
    await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 3 }), env, params: { id: String(knownRowId) } });
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 1 }), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(400);
  });

  it('blocks reconciling past a known raw_quantity (bulk case)', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: bulkCategoryId, quantity: 4 }), env, params: { id: String(knownRowId) } });
    expect(response.status).toBe(400);
  });

  it('does not block reconciling when raw_quantity is NULL ("Chưa xác định")', async () => {
    const first = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${unknownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 50 }), env, params: { id: String(unknownRowId) } });
    expect(first.status).toBe(201);
    const second = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${unknownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 50 }), env, params: { id: String(unknownRowId) } });
    expect(second.status).toBe(201);
  });

  it('rejects a count above the 200 hard cap even when raw_quantity is NULL', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${unknownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 201 }), env, params: { id: String(unknownRowId) } });
    expect(response.status).toBe(400);
  });

  it('accepts a count exactly at the 200 hard cap', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${unknownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 200 }), env, params: { id: String(unknownRowId) } });
    expect(response.status).toBe(201);
    const { createdIds } = await response.json();
    expect(createdIds).toHaveLength(200);
  });

  it('writes an asset_create audit_log row for each created asset', async () => {
    const response = await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 2 }), env, params: { id: String(knownRowId) } });
    const { createdIds } = await response.json();
    for (const id of createdIds) {
      const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_create' AND entity_id = ?`).bind(id).first();
      expect(audit).not.toBeNull();
    }
  });

  it('never modifies the source row itself', async () => {
    const before = await env.DB.prepare(`SELECT * FROM asset_source_rows WHERE id = ?`).bind(knownRowId).first();
    await reconcileRow({ request: authedRequest(`https://x/api/asset-source-rows/${knownRowId}/reconcile`, adminToken, 'POST', { categoryId: individualCategoryId, count: 2 }), env, params: { id: String(knownRowId) } });
    const after = await env.DB.prepare(`SELECT * FROM asset_source_rows WHERE id = ?`).bind(knownRowId).first();
    expect(after).toEqual(before);
  });
});
