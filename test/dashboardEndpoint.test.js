import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getSummary } from '../functions/api/dashboard/summary.js';
import { createSession } from '../lib/auth.js';

let managerToken;
let receptionToken;
let observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'observer_a', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 3);
});

function authedRequest(url, token) {
  return new Request(url, { headers: { Cookie: `session=${token}` } });
}

describe('GET /api/dashboard/summary', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const response = await getSummary({ request: new Request('https://x/api/dashboard/summary'), env });
    expect(response.status).toBe(401);
  });

  it('rejects reception-role requests with 403 (manager-only)', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary', receptionToken), env });
    expect(response.status).toBe(403);
  });

  it('returns today and monthSummary for a manager, defaulting to the current month', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    const expectedMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
    expect(body.month).toBe(expectedMonth);
    expect(body.today).toHaveProperty('roomsOccupied');
    expect(body.today).toHaveProperty('roomsEmpty');
    expect(body.monthSummary).toHaveProperty('occupancyRate');
    expect(body.monthSummary).toHaveProperty('roomRevenueVnd');
    expect(body.monthSummary).toHaveProperty('serviceRevenueVnd');
    expect(body.monthSummary).toHaveProperty('totalRevenueVnd');
    expect(body.monthSummary).toHaveProperty('adrVnd');
    expect(body.monthSummary.statusFunnel).toEqual({ pending: 0, confirmed: 0, checked_in: 0, checked_out: 0, cancelled: 0 });
  });

  it('accepts an explicit month param', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary?month=2026-01', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.month).toBe('2026-01');
  });

  it('rejects an out-of-range month param with 400', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary?month=2026-13', managerToken), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed month param with 400', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary?month=August', managerToken), env });
    expect(response.status).toBe(400);
  });

  it('lets an observer view the summary', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/dashboard/summary', observerToken), env });
    expect(response.status).toBe(200);
  });
});
