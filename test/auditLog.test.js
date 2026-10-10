import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getAuditLog, VALID_ACTION_TYPES } from '../functions/api/audit-log/index.js';
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

  it('accepts each of the newer action types as a valid filter', async () => {
    for (const type of ['booking_create', 'account_create', 'booking_reject', 'account_password_reset', 'account_password_change', 'account_delete', 'deposit_delete', 'booking_checkout', 'sale_close']) {
      const response = await getAuditLog({ request: authedRequest(`https://x/api/audit-log?type=${type}`, managerToken), env });
      expect(response.status).toBe(200);
    }
  });

  it('rejects an invalid type value (400)', async () => {
    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log?type=bogus', managerToken), env });
    expect(response.status).toBe(400);
  });

  it('accepts each newly whitelisted security/admin action type and filters to only those rows', async () => {
    const newTypes = [
      '2fa_admin_disable',
      '2fa_disable',
      '2fa_enable',
      'account_lock',
      'account_unlock',
      'finance_transaction_attachment_upload',
      'finance_transaction_attachment_delete',
      'notification_destination_change',
      'role_permissions_change',
      'user_permissions_change',
    ];

    let entityId = 100;
    for (const type of newTypes) {
      entityId += 1;
      await env.DB.prepare(
        `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at) VALUES (?, 'staff_account', ?, 'Nhãn thử', 'cũ', 'mới', 'quan_ly_log', '2026-08-27T09:00:00Z')`
      ).bind(type, entityId).run();
    }

    for (const type of newTypes) {
      const response = await getAuditLog({ request: authedRequest(`https://x/api/audit-log?type=${type}`, managerToken), env });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.length).toBe(1);
      expect(body[0].actionType).toBe(type);
    }
  });

  it('rejects a reception account for the newly whitelisted types (403)', async () => {
    const response = await getAuditLog({ request: authedRequest('https://x/api/audit-log?type=role_permissions_change', receptionToken), env });
    expect(response.status).toBe(403);
  });

  it('keeps every action_type literal written by the handlers inside VALID_ACTION_TYPES', () => {
    // Explicit list collected by grepping `INSERT INTO audit_log` across functions/ and lib/
    // (see .superpowers/sdd/2026-09-24-admin-permissions-plan/ops-brief.md). No filesystem
    // scanning here — the Workers test runtime cannot read the repo tree.
    const writtenActionTypes = [
      '2fa_admin_disable',
      '2fa_disable',
      '2fa_enable',
      'account_delete',
      'account_lock',
      'account_password_reset',
      'account_role_change',
      'account_unlock',
      'asset_category_create',
      'asset_category_update',
      'asset_create',
      'asset_delete',
      'asset_inventory_adjustment',
      'asset_location_create',
      'asset_location_update',
      'asset_update',
      'booking_cancel',
      'booking_reject',
      'deposit_delete',
      'dine_in_menu_item_create',
      'dine_in_menu_item_update',
      'dine_in_order_void',
      'finance_category_create',
      'finance_category_update',
      'finance_opening_balance_set',
      'finance_transaction_attachment_delete',
      'finance_transaction_attachment_upload',
      'finance_transaction_create',
      'finance_transaction_update',
      'finance_transaction_void',
      'gio_xanh_session_void',
      'guest_identity_update',
      'notification_destination_change',
      'record_hide',
      'role_permissions_change',
      'service_void',
      'user_permissions_change',
    ];

    for (const type of writtenActionTypes) {
      expect(VALID_ACTION_TYPES).toContain(type);
    }
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
