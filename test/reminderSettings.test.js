import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getSettings, onRequestPatch as patchSettings } from '../functions/api/reminder-settings.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM reminder_settings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_r', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_r', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'admin_r', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, 3);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (4, 'quan_sat_r', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 4);
});

function authedRequest(url, token, method = 'GET', body) {
  const headers = token ? { Cookie: `session=${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/reminder-settings', () => {
  it('returns the default 2/60 when the table is empty', async () => {
    const response = await getSettings({ request: authedRequest('https://x/api/reminder-settings', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ pendingDepositHours: 2, cleaningMinutes: 60, updatedAt: null });
  });

  it('returns the seeded values when a row exists', async () => {
    await env.DB.prepare(`INSERT INTO reminder_settings (pending_deposit_hours, cleaning_minutes, updated_at) VALUES (3, 90, '2026-08-27T00:00:00Z')`).run();
    const response = await getSettings({ request: authedRequest('https://x/api/reminder-settings', receptionToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pendingDepositHours).toBe(3);
    expect(body.cleaningMinutes).toBe(90);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await getSettings({ request: new Request('https://x/api/reminder-settings'), env });
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/reminder-settings', () => {
  it('lets an admin update the thresholds', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/reminder-settings', adminToken, 'PATCH', { pendingDepositHours: 4, cleaningMinutes: 45 }), env });
    expect(response.status).toBe(200);

    const getResponse = await getSettings({ request: authedRequest('https://x/api/reminder-settings', adminToken), env });
    const body = await getResponse.json();
    expect(body.pendingDepositHours).toBe(4);
    expect(body.cleaningMinutes).toBe(45);
  });

  it('inserts a new row rather than mutating the existing one', async () => {
    await patchSettings({ request: authedRequest('https://x/api/reminder-settings', adminToken, 'PATCH', { pendingDepositHours: 4, cleaningMinutes: 45 }), env });
    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reminder_settings`).first();
    expect(countRow.n).toBe(1);

    await patchSettings({ request: authedRequest('https://x/api/reminder-settings', adminToken, 'PATCH', { pendingDepositHours: 5, cleaningMinutes: 30 }), env });
    const countRow2 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reminder_settings`).first();
    expect(countRow2.n).toBe(2);
  });

  it('rejects a manager (403) -- admin-only', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/reminder-settings', managerToken, 'PATCH', { pendingDepositHours: 4, cleaningMinutes: 45 }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a reception account (403)', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/reminder-settings', receptionToken, 'PATCH', { pendingDepositHours: 4, cleaningMinutes: 45 }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a zero value (400)', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/reminder-settings', adminToken, 'PATCH', { pendingDepositHours: 0, cleaningMinutes: 45 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a non-integer value (400)', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/reminder-settings', adminToken, 'PATCH', { pendingDepositHours: 2.5, cleaningMinutes: 45 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a value above the upper bound (400)', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/reminder-settings', adminToken, 'PATCH', { pendingDepositHours: 9000, cleaningMinutes: 45 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await patchSettings({ request: new Request('https://x/api/reminder-settings', { method: 'PATCH' }), env });
    expect(response.status).toBe(401);
  });
});
