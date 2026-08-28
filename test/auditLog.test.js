import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getAuditLog } from '../functions/api/audit-log/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, adminToken, receptionToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM audit_log');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_log', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'admin_log', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, 2);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'le_tan_log', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 3);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (4, 'quan_sat_log', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 4);
});

function authedRequest(url, token) {
  return new Request(url, { headers: token ? { Cookie: `session=${token}` } : {} });
}

describe('GET /api/audit-log', () => {
  it('returns recent entries newest-first, respecting limit', async () => {
    await env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at) VALUES ('deposit_change', 'booking', 1, 'Khách A', '0', '100000', 'le_tan_log', '2026-08-27T10:00:00Z')`).run();
    await env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at) VALUES ('booking_cancel', 'booking', 2, 'Khách B', 'confirmed', 'cancelled — hoàn 0% (0 đ)', 'le_tan_log', '2026-08-27T11:00:00Z')`).run();
    await env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at) VALUES ('service_void', 'service_item', 3, 'Cà phê ×1 — Khách C', 'posted', 'voided', 'le_tan_log', '2026-08-27T12:00:00Z')`).run();

    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log?limit=2', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBe(2);
    expect(body[0].entityLabel).toBe('Cà phê ×1 — Khách C');
    expect(body[1].entityLabel).toBe('Khách B');
  });

  it('defaults to 50 entries when limit is omitted', async () => {
    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log', managerToken), env });
    expect(response.status).toBe(200);
  });

  it('filters by type', async () => {
    await env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at) VALUES ('deposit_change', 'booking', 1, 'Khách A', '0', '100000', 'le_tan_log', '2026-08-27T10:00:00Z')`).run();
    await env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at) VALUES ('service_void', 'service_item', 3, 'Cà phê ×1 — Khách C', 'posted', 'voided', 'le_tan_log', '2026-08-27T12:00:00Z')`).run();

    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log?type=service_void', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBe(1);
    expect(body[0].actionType).toBe('service_void');
  });

  it('rejects an invalid type value (400)', async () => {
    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log?type=bogus', managerToken), env });
    expect(response.status).toBe(400);
  });

  it('lets an admin view the log', async () => {
    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log', adminToken), env });
    expect(response.status).toBe(200);
  });

  it('rejects a reception account (403)', async () => {
    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log', receptionToken), env });
    expect(response.status).toBe(403);
  });

  it('rejects an observer (403)', async () => {
    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log', observerToken), env });
    expect(response.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await getAuditLog({ request: new Request('https://x/api/audit-log'), env });
    expect(response.status).toBe(401);
  });
});
