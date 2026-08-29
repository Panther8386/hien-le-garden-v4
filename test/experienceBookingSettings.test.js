import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getSettings, onRequestPatch as patchSettings } from '../functions/api/experience-booking-settings.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM experience_booking_settings');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_eb', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_eb', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'admin_eb', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, 3);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (4, 'quan_sat_eb', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 4);
});

function authedRequest(url, token, method = 'GET', body) {
  const headers = token ? { Cookie: `session=${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/experience-booking-settings', () => {
  it('returns the default 14/5 when the table is empty', async () => {
    const response = await getSettings({ request: authedRequest('https://x/api/experience-booking-settings', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ suggestionWindowDays: 14, maxSuggestions: 5, updatedAt: null });
  });

  it('returns the seeded values when a row exists', async () => {
    await env.DB.prepare(`INSERT INTO experience_booking_settings (suggestion_window_days, max_suggestions, updated_at) VALUES (21, 3, '2026-08-27T00:00:00Z')`).run();
    const response = await getSettings({ request: authedRequest('https://x/api/experience-booking-settings', receptionToken), env });
    const body = await response.json();
    expect(body.suggestionWindowDays).toBe(21);
    expect(body.maxSuggestions).toBe(3);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await getSettings({ request: new Request('https://x/api/experience-booking-settings'), env });
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/experience-booking-settings', () => {
  it('lets an admin update the values', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/experience-booking-settings', adminToken, 'PATCH', { suggestionWindowDays: 10, maxSuggestions: 3 }), env });
    expect(response.status).toBe(200);

    const getResponse = await getSettings({ request: authedRequest('https://x/api/experience-booking-settings', adminToken), env });
    const body = await getResponse.json();
    expect(body.suggestionWindowDays).toBe(10);
    expect(body.maxSuggestions).toBe(3);
  });

  it('inserts a new row rather than mutating the existing one', async () => {
    await patchSettings({ request: authedRequest('https://x/api/experience-booking-settings', adminToken, 'PATCH', { suggestionWindowDays: 10, maxSuggestions: 3 }), env });
    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM experience_booking_settings`).first();
    expect(countRow.n).toBe(1);

    await patchSettings({ request: authedRequest('https://x/api/experience-booking-settings', adminToken, 'PATCH', { suggestionWindowDays: 7, maxSuggestions: 5 }), env });
    const countRow2 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM experience_booking_settings`).first();
    expect(countRow2.n).toBe(2);
  });

  it('rejects a manager (403) -- admin-only', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/experience-booking-settings', managerToken, 'PATCH', { suggestionWindowDays: 10, maxSuggestions: 3 }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a reception account (403)', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/experience-booking-settings', receptionToken, 'PATCH', { suggestionWindowDays: 10, maxSuggestions: 3 }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a zero value (400)', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/experience-booking-settings', adminToken, 'PATCH', { suggestionWindowDays: 0, maxSuggestions: 3 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a value above the upper bound (400)', async () => {
    const response = await patchSettings({ request: authedRequest('https://x/api/experience-booking-settings', adminToken, 'PATCH', { suggestionWindowDays: 400, maxSuggestions: 3 }), env });
    expect(response.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await patchSettings({ request: new Request('https://x/api/experience-booking-settings', { method: 'PATCH' }), env });
    expect(response.status).toBe(401);
  });
});
