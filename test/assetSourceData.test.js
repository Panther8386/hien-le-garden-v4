import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listDocuments } from '../functions/api/asset-source-documents/index.js';
import { onRequestGet as listSourceRows } from '../functions/api/asset-source-rows/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, adminToken, documentId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM asset_source_rows');
  await env.DB.exec('DELETE FROM asset_source_documents');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_sd', 'x', 'manager', '2026-09-07T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_sd', 'x', 'admin', '2026-09-07T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);

  const docInsert = await env.DB.prepare(
    `INSERT INTO asset_source_documents (title, contract_ref, created_by, created_at) VALUES ('Phụ lục II — Test', '001/TEST', 'admin_sd', '2026-09-07T00:00:00Z')`
  ).run();
  documentId = docInsert.meta.last_row_id;
  await env.DB.prepare(
    `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_unit, raw_quantity, raw_condition, raw_note, created_at)
     VALUES (?, 'A. TEST', 2, 'Second Item', 'cái', NULL, 'Tốt', NULL, '2026-09-07T00:00:00Z')`
  ).bind(documentId).run();
  await env.DB.prepare(
    `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_unit, raw_quantity, raw_condition, raw_note, created_at)
     VALUES (?, 'A. TEST', 1, 'First Item', 'phòng', '15', 'Tốt', 'Vip1', '2026-09-07T00:00:00Z')`
  ).bind(documentId).run();
});

function authedRequest(url, token) {
  return new Request(url, { headers: token ? { Cookie: `session=${token}` } : {} });
}

describe('GET /api/asset-source-documents', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listDocuments({ request: new Request('https://x/api/asset-source-documents'), env });
    expect(response.status).toBe(401);
  });

  it('lets manager and admin read', async () => {
    for (const token of [managerToken, adminToken]) {
      const response = await listDocuments({ request: authedRequest('https://x/api/asset-source-documents', token), env });
      expect(response.status).toBe(200);
    }
  });

  it('returns the seeded document with the correct fields', async () => {
    const response = await listDocuments({ request: authedRequest('https://x/api/asset-source-documents', managerToken), env });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'Phụ lục II — Test', contractRef: '001/TEST' });
  });
});

describe('GET /api/asset-source-rows', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listSourceRows({ request: new Request(`https://x/api/asset-source-rows?documentId=${documentId}`), env });
    expect(response.status).toBe(401);
  });

  it('rejects a missing documentId (400)', async () => {
    const response = await listSourceRows({ request: authedRequest('https://x/api/asset-source-rows', managerToken), env });
    expect(response.status).toBe(400);
  });

  it('returns rows sorted by stt regardless of insertion order', async () => {
    const response = await listSourceRows({ request: authedRequest(`https://x/api/asset-source-rows?documentId=${documentId}`, managerToken), env });
    const body = await response.json();
    expect(body.map((r) => r.stt)).toEqual([1, 2]);
    expect(body[0].rawName).toBe('First Item');
  });

  it('preserves a NULL rawQuantity as null, not 0 or a string "0"', async () => {
    const response = await listSourceRows({ request: authedRequest(`https://x/api/asset-source-rows?documentId=${documentId}`, managerToken), env });
    const body = await response.json();
    const row2 = body.find((r) => r.stt === 2);
    expect(row2.rawQuantity).toBeNull();
  });

  it('preserves rawQuantity text formatting like a leading zero', async () => {
    const response = await listSourceRows({ request: authedRequest(`https://x/api/asset-source-rows?documentId=${documentId}`, managerToken), env });
    const body = await response.json();
    const row1 = body.find((r) => r.stt === 1);
    expect(row1.rawQuantity).toBe('15');
    expect(row1.rawNote).toBe('Vip1');
  });
});
