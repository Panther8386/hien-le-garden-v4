import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getTiers, onRequestPost as postTier } from '../functions/api/cancellation-policy/index.js';
import { onRequestPatch as patchTier, onRequestDelete as deleteTier } from '../functions/api/cancellation-policy/[id].js';
import { createSession } from '../lib/auth.js';

let managerId, receptionId, adminId, observerId, managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM cancellation_policy_tier');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_policy', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_policy', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_policy', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_policy', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerId = m.meta.last_row_id;
  receptionId = r.meta.last_row_id;
  adminId = a.meta.last_row_id;
  observerId = o.meta.last_row_id;
  managerToken = await createSession(env.DB, managerId);
  receptionToken = await createSession(env.DB, receptionId);
  adminToken = await createSession(env.DB, adminId);
  observerToken = await createSession(env.DB, observerId);

  await env.DB.prepare(
    `INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, label, display_order, updated_by, updated_at) VALUES (7, 100, 'Huỷ trước 7 ngày', 1, 'seed', '2026-08-01T00:00:00Z')`
  ).run();
  await env.DB.prepare(
    `INSERT INTO cancellation_policy_tier (min_days_before_checkin, refund_percent, label, display_order, updated_by, updated_at) VALUES (0, 0, NULL, 2, 'seed', '2026-08-01T00:00:00Z')`
  ).run();
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/cancellation-policy', () => {
  it('lets reception view tiers, ordered newest-threshold-first', async () => {
    const response = await getTiers({ request: authedRequest('https://x/api/cancellation-policy', receptionToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.map((t) => t.minDaysBeforeCheckin)).toEqual([7, 0]);
  });

  it("lets observer view tiers (matches the catalog GET precedent, not promo_policy's)", async () => {
    const response = await getTiers({ request: authedRequest('https://x/api/cancellation-policy', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.map((t) => t.minDaysBeforeCheckin)).toEqual([7, 0]);
  });

  it('rejects no session (401)', async () => {
    const response = await getTiers({ request: new Request('https://x/api/cancellation-policy'), env });
    expect(response.status).toBe(401);
  });

  it('?public=1 needs no session at all', async () => {
    const response = await getTiers({ request: new Request('https://x/api/cancellation-policy?public=1'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
  });
});

describe('POST /api/cancellation-policy', () => {
  it('lets an admin add a tier', async () => {
    const response = await postTier({ request: authedRequest('https://x/api/cancellation-policy', adminToken, 'POST', { minDaysBeforeCheckin: 3, refundPercent: 50, label: 'Huỷ trước 3 ngày' }), env });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(`SELECT * FROM cancellation_policy_tier WHERE min_days_before_checkin = 3`).first();
    expect(row.refund_percent).toBe(50);
  });

  it('rejects refundPercent over 100 (400)', async () => {
    const response = await postTier({ request: authedRequest('https://x/api/cancellation-policy', adminToken, 'POST', { minDaysBeforeCheckin: 3, refundPercent: 150 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a negative minDaysBeforeCheckin (400)', async () => {
    const response = await postTier({ request: authedRequest('https://x/api/cancellation-policy', adminToken, 'POST', { minDaysBeforeCheckin: -1, refundPercent: 50 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects manager (403)', async () => {
    const response = await postTier({ request: authedRequest('https://x/api/cancellation-policy', managerToken, 'POST', { minDaysBeforeCheckin: 3, refundPercent: 50 }), env });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/cancellation-policy/:id', () => {
  it('lets an admin edit a tier', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM cancellation_policy_tier WHERE min_days_before_checkin = 7`).first();
    const response = await patchTier({ request: authedRequest(`https://x/api/cancellation-policy/${existing.id}`, adminToken, 'PATCH', { refundPercent: 90 }), env, params: { id: String(existing.id) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT refund_percent FROM cancellation_policy_tier WHERE id = ?`).bind(existing.id).first();
    expect(row.refund_percent).toBe(90);
  });

  it('404s for a missing id', async () => {
    const response = await patchTier({ request: authedRequest('https://x/api/cancellation-policy/999999', adminToken, 'PATCH', { refundPercent: 90 }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/cancellation-policy/:id', () => {
  it('lets an admin delete a tier', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM cancellation_policy_tier WHERE min_days_before_checkin = 7`).first();
    const response = await deleteTier({ request: authedRequest(`https://x/api/cancellation-policy/${existing.id}`, adminToken, 'DELETE'), env, params: { id: String(existing.id) } });
    expect(response.status).toBe(204);
  });

  it('rejects reception (403)', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM cancellation_policy_tier WHERE min_days_before_checkin = 7`).first();
    const response = await deleteTier({ request: authedRequest(`https://x/api/cancellation-policy/${existing.id}`, receptionToken, 'DELETE'), env, params: { id: String(existing.id) } });
    expect(response.status).toBe(403);
  });
});
