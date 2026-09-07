import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listLocations, onRequestPost as createLocation } from '../functions/api/asset-locations/index.js';
import { onRequestPatch as patchLocation } from '../functions/api/asset-locations/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken, roomId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM asset_locations');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_al', 'x', 'manager', '2026-09-07T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_al', 'x', 'reception', '2026-09-07T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_al', 'x', 'admin', '2026-09-07T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_al', 'x', 'observer', '2026-09-07T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();
  roomId = roomRow.id;
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/asset-locations', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listLocations({ request: new Request('https://x/api/asset-locations'), env });
    expect(response.status).toBe(401);
  });

  it('lets all 4 roles read', async () => {
    for (const token of [managerToken, receptionToken, adminToken, observerToken]) {
      const response = await listLocations({ request: authedRequest('https://x/api/asset-locations', token, 'GET'), env });
      expect(response.status).toBe(200);
    }
  });

  it('rejects an invalid type filter (400)', async () => {
    const response = await listLocations({ request: authedRequest('https://x/api/asset-locations?type=not_real', managerToken, 'GET'), env });
    expect(response.status).toBe(400);
  });

  it('filters by type', async () => {
    await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('warehouse', 'Kho BP', 'admin_al', '2026-09-07T00:00:00Z')`).run();
    await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('common_area', 'Sân vườn', 'admin_al', '2026-09-07T00:00:00Z')`).run();
    const response = await listLocations({ request: authedRequest('https://x/api/asset-locations?type=warehouse', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((l) => l.name)).toEqual(['Kho BP']);
  });

  it('excludes inactive locations by default, includes them with includeInactive=1', async () => {
    await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, is_active, created_by, created_at) VALUES ('warehouse', 'Kho cũ', 0, 'admin_al', '2026-09-07T00:00:00Z')`).run();
    const defaultResponse = await listLocations({ request: authedRequest('https://x/api/asset-locations', managerToken, 'GET'), env });
    expect(await defaultResponse.json()).toHaveLength(0);
    const includeResponse = await listLocations({ request: authedRequest('https://x/api/asset-locations?includeInactive=1', managerToken, 'GET'), env });
    expect(await includeResponse.json()).toHaveLength(1);
  });
});

describe('POST /api/asset-locations', () => {
  it('rejects manager (403)', async () => {
    const response = await createLocation({ request: authedRequest('https://x/api/asset-locations', managerToken, 'POST', { locationType: 'warehouse', name: 'X' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid locationType (400)', async () => {
    const response = await createLocation({ request: authedRequest('https://x/api/asset-locations', adminToken, 'POST', { locationType: 'not_real', name: 'X' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a room location with no roomId (400)', async () => {
    const response = await createLocation({ request: authedRequest('https://x/api/asset-locations', adminToken, 'POST', { locationType: 'room', name: 'X' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a non-room location that includes a roomId (400)', async () => {
    const response = await createLocation({ request: authedRequest('https://x/api/asset-locations', adminToken, 'POST', { locationType: 'warehouse', roomId, name: 'X' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a roomId that already has an asset_locations row (400)', async () => {
    await createLocation({ request: authedRequest('https://x/api/asset-locations', adminToken, 'POST', { locationType: 'room', roomId, name: 'Phòng 1' }), env });
    const response = await createLocation({ request: authedRequest('https://x/api/asset-locations', adminToken, 'POST', { locationType: 'room', roomId, name: 'Phòng 1 lần 2' }), env });
    expect(response.status).toBe(400);
  });

  it('creates a room-type location as admin and writes an audit_log row', async () => {
    const response = await createLocation({ request: authedRequest('https://x/api/asset-locations', adminToken, 'POST', { locationType: 'room', roomId, code: 'P01', name: 'Phòng 1' }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT location_type, room_id, code FROM asset_locations WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ location_type: 'room', room_id: roomId, code: 'P01' });
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_location_create' AND entity_id = ?`).bind(body.id).first();
    expect(audit.entity_type).toBe('asset_location');
  });

  it('creates a warehouse location with no roomId', async () => {
    const response = await createLocation({ request: authedRequest('https://x/api/asset-locations', adminToken, 'POST', { locationType: 'warehouse', code: 'BP', name: 'Buồng phòng' }), env });
    expect(response.status).toBe(201);
  });
});

describe('PATCH /api/asset-locations/:id', () => {
  let locationId;

  beforeEach(async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO asset_locations (location_type, room_id, code, name, created_by, created_at) VALUES ('room', ?, 'P01', 'Phòng 1', 'admin_al', '2026-09-07T00:00:00Z')`
    ).bind(roomId).run();
    locationId = insert.meta.last_row_id;
  });

  it('rejects manager (403)', async () => {
    const response = await patchLocation({ request: authedRequest(`https://x/api/asset-locations/${locationId}`, managerToken, 'PATCH', { name: 'X' }), env, params: { id: String(locationId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await patchLocation({ request: authedRequest('https://x/api/asset-locations/999999', adminToken, 'PATCH', { name: 'X' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an attempt to change locationType (400)', async () => {
    const response = await patchLocation({ request: authedRequest(`https://x/api/asset-locations/${locationId}`, adminToken, 'PATCH', { locationType: 'warehouse' }), env, params: { id: String(locationId) } });
    expect(response.status).toBe(400);
  });

  it('rejects an attempt to change roomId (400)', async () => {
    const response = await patchLocation({ request: authedRequest(`https://x/api/asset-locations/${locationId}`, adminToken, 'PATCH', { roomId: 999 }), env, params: { id: String(locationId) } });
    expect(response.status).toBe(400);
  });

  it('updates name/code/note and writes an audit_log row, without touching room_id', async () => {
    const response = await patchLocation({ request: authedRequest(`https://x/api/asset-locations/${locationId}`, adminToken, 'PATCH', { name: 'Phòng số 1', code: 'P001', note: 'Đổi tên hiển thị' }), env, params: { id: String(locationId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT name, code, note, room_id FROM asset_locations WHERE id = ?`).bind(locationId).first();
    expect(row).toEqual({ name: 'Phòng số 1', code: 'P001', note: 'Đổi tên hiển thị', room_id: roomId });
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'asset_location_update' AND entity_id = ?`).bind(locationId).first();
    expect(audit.old_value).toBe('Phòng 1');
    expect(audit.new_value).toBe('Phòng số 1');
  });

  it('toggles isActive', async () => {
    await patchLocation({ request: authedRequest(`https://x/api/asset-locations/${locationId}`, adminToken, 'PATCH', { isActive: false }), env, params: { id: String(locationId) } });
    const row = await env.DB.prepare(`SELECT is_active FROM asset_locations WHERE id = ?`).bind(locationId).first();
    expect(row.is_active).toBe(0);
  });
});
