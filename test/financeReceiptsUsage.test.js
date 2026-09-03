import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getReceiptsUsage } from '../functions/api/finance/receipts-usage.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_usage', 'x', 'manager', '2026-09-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_usage', 'x', 'reception', '2026-09-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_usage', 'x', 'observer', '2026-09-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  // Clear out any objects a previous test in this file left behind.
  const listing = await env.RECEIPTS.list();
  for (const obj of listing.objects) await env.RECEIPTS.delete(obj.key);
});

function authedRequest(url, token) {
  const headers = {};
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method: 'GET', headers });
}

describe('GET /api/finance/receipts-usage', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getReceiptsUsage({ request: authedRequest('https://x/api/finance/receipts-usage', null), env });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await getReceiptsUsage({ request: authedRequest('https://x/api/finance/receipts-usage', receptionToken), env });
    expect(response.status).toBe(403);
  });

  it('rejects observer (403)', async () => {
    const response = await getReceiptsUsage({ request: authedRequest('https://x/api/finance/receipts-usage', observerToken), env });
    expect(response.status).toBe(403);
  });

  it('sums object sizes across the bucket and reports under the 9GB threshold when empty', async () => {
    const response = await getReceiptsUsage({ request: authedRequest('https://x/api/finance/receipts-usage', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalBytes).toBe(0);
    expect(body.thresholdBytes).toBe(9 * 1024 * 1024 * 1024);
    expect(body.overThreshold).toBe(false);
  });

  it('sums multiple objects correctly', async () => {
    await env.RECEIPTS.put('finance-receipts/1/a.pdf', new Uint8Array(1000));
    await env.RECEIPTS.put('finance-receipts/2/b.pdf', new Uint8Array(2000));
    const response = await getReceiptsUsage({ request: authedRequest('https://x/api/finance/receipts-usage', managerToken), env });
    const body = await response.json();
    expect(body.totalBytes).toBe(3000);
    expect(body.overThreshold).toBe(false);
  });
});
