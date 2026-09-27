import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestDelete as deleteUser } from '../functions/api/users/[id].js';
import { onRequestPatch as changeRole } from '../functions/api/users/[id]/role.js';
import { onRequestPatch as resetPassword } from '../functions/api/users/[id]/password.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { createSession, verifyPassword, createPending2FAToken, getPendingStaffId } from '../lib/auth.js';
import { requireAuth } from '../lib/requireAuth.js';

let managerAId, managerBId, receptionId, adminId, observerId, managerAToken, receptionToken, adminToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');

  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const b = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_b', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const c = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  const d = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_a', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  const e = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_a', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerAId = a.meta.last_row_id;
  managerBId = b.meta.last_row_id;
  receptionId = c.meta.last_row_id;
  adminId = d.meta.last_row_id;
  observerId = e.meta.last_row_id;
  managerAToken = await createSession(env.DB, managerAId);
  receptionToken = await createSession(env.DB, receptionId);
  adminToken = await createSession(env.DB, adminId);
});

function authedRequest(url, token, method, body) {
  return new Request(url, { method, headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

describe('DELETE /api/users/:id', () => {
  it('lets a manager delete a reception account', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${receptionId}`, managerAToken, 'DELETE'), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(204);
  });

  it('rejects deleting your own account (400)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerAId}`, managerAToken, 'DELETE'), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(400);
  });

  it('rejects a manager deleting another manager (403) -- account hierarchy, FA-1', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, managerAToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('Không thể thao tác trên tài khoản cùng cấp hoặc cấp cao hơn');

    const managerCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'manager'`).first();
    expect(managerCount.n).toBe(2);
  });

  it('rejects the only active admin deleting themselves (400)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${adminId}`, adminToken, 'DELETE'), env, params: { id: String(adminId) } });
    expect(response.status).toBe(400);
    const row = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE id = ?`).bind(adminId).first();
    expect(row).not.toBeNull();
  });

  it('rejects a manager deleting an admin (403)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${adminId}`, managerAToken, 'DELETE'), env, params: { id: String(adminId) } });
    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent account', async () => {
    const response = await deleteUser({ request: authedRequest('https://x/api/users/999999', managerAToken, 'DELETE'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects a reception account (403)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, receptionToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });

  it('writes an audit_log row with the deleted role', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${receptionId}`, managerAToken, 'DELETE'), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(204);

    const row = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'account_delete' AND entity_id = ?`).bind(receptionId).first();
    expect(row.entity_type).toBe('staff_account');
    expect(row.entity_label).toBe('le_tan_a');
    expect(row.old_value).toBe('reception');
    expect(row.new_value).toBe('deleted');
    expect(row.actor).toBe('quan_ly_a');
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('lets a manager change a lower-ranked account role', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${observerId}/role`, managerAToken, 'PATCH', { role: 'reception' }), env, params: { id: String(observerId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(observerId).first();
    expect(row.role).toBe('reception');
  });

  it('rejects a manager promoting an account to manager (403) -- account hierarchy, FA-1', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'manager' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(403);
    const row = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(receptionId).first();
    expect(row.role).toBe('reception');
  });

  it('writes an audit_log row with the old and new role', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'observer' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'account_role_change' AND entity_id = ?`).bind(receptionId).first();
    expect(row.entity_type).toBe('staff_account');
    expect(row.entity_label).toBe('le_tan_a');
    expect(row.old_value).toBe('reception');
    expect(row.new_value).toBe('observer');
    expect(row.actor).toBe('quan_ly_a');
  });

  it('lets an admin change a role', async () => {
    const request = authedRequest(`https://x/api/users/${receptionId}/role`, adminToken, 'PATCH', { role: 'observer' });
    const response = await changeRole({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);
  });

  it('rejects an invalid role value', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'superadmin' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(400);
  });

  it('allows demoting the last manager -- the old last-manager rule is replaced by the last-active-admin rule', async () => {
    await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, adminToken, 'DELETE'), env, params: { id: String(managerBId) } });
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerAId}/role`, adminToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(managerAId).first();
    expect(row.role).toBe('reception');
  });

  it('rejects the only active admin demoting themselves (400)', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${adminId}/role`, adminToken, 'PATCH', { role: 'manager' }), env, params: { id: String(adminId) } });
    expect(response.status).toBe(400);
    const row = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(adminId).first();
    expect(row.role).toBe('admin');
  });

  it('rejects a manager changing their own role (400)', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerAId}/role`, managerAToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent account', async () => {
    const response = await changeRole({ request: authedRequest('https://x/api/users/999999/role', managerAToken, 'PATCH', { role: 'reception' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects a reception account (403)', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerBId}/role`, receptionToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/users/:id/password', () => {
  it('lets an admin reset another account\'s password', async () => {
    const request = authedRequest(`https://x/api/users/${receptionId}/password`, adminToken, 'PATCH', { password: 'MatKhauMoi123' });
    const response = await resetPassword({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT password_hash FROM staff_accounts WHERE id = ?`).bind(receptionId).first();
    expect(await verifyPassword('MatKhauMoi123', row.password_hash)).toBe(true);
  });

  it('writes an audit_log row without storing any password value', async () => {
    const request = authedRequest(`https://x/api/users/${receptionId}/password`, adminToken, 'PATCH', { password: 'MatKhauMoi123' });
    const response = await resetPassword({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'account_password_reset' AND entity_id = ?`).bind(receptionId).first();
    expect(row.entity_type).toBe('staff_account');
    expect(row.entity_label).toBe('le_tan_a');
    expect(row.old_value).toBeNull();
    expect(row.new_value).toBe('Đã đặt lại mật khẩu');
    expect(row.actor).toBe('admin_a');
  });

  it('rejects a manager (403) -- admin-only, not the usual manager+admin', async () => {
    const request = authedRequest(`https://x/api/users/${receptionId}/password`, managerAToken, 'PATCH', { password: 'MatKhauMoi123' });
    const response = await resetPassword({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(403);
  });

  it('rejects a reception account (403)', async () => {
    const request = authedRequest(`https://x/api/users/${managerBId}/password`, receptionToken, 'PATCH', { password: 'MatKhauMoi123' });
    const response = await resetPassword({ request, env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });

  it('rejects an admin resetting their own password through this endpoint (400)', async () => {
    const request = authedRequest(`https://x/api/users/${adminId}/password`, adminToken, 'PATCH', { password: 'MatKhauMoi123' });
    const response = await resetPassword({ request, env, params: { id: String(adminId) } });
    expect(response.status).toBe(400);
  });

  it('rejects a password shorter than 8 characters (400)', async () => {
    const request = authedRequest(`https://x/api/users/${receptionId}/password`, adminToken, 'PATCH', { password: 'short' });
    const response = await resetPassword({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent account', async () => {
    const request = authedRequest('https://x/api/users/999999/password', adminToken, 'PATCH', { password: 'MatKhauMoi123' });
    const response = await resetPassword({ request, env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('revokes every existing session and pending 2FA token of the target, keeps the admin session, and the new password logs in', async () => {
    const oldToken1 = receptionToken;
    const oldToken2 = await createSession(env.DB, receptionId);
    const pendingToken = await createPending2FAToken(env.DB, receptionId);
    const probe = (token) => requireAuth(new Request('https://x/api/auth/me', { headers: { Cookie: `session=${token}` } }), env);
    expect((await probe(oldToken1)).staffId).toBe(receptionId);
    expect((await probe(oldToken2)).staffId).toBe(receptionId);

    const response = await resetPassword({ request: authedRequest(`https://x/api/users/${receptionId}/password`, adminToken, 'PATCH', { password: 'MatKhauMoi123' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);

    for (const token of [oldToken1, oldToken2]) {
      const res = await probe(token);
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(401);
    }
    expect(await getPendingStaffId(env.DB, pendingToken)).toBeNull();
    const pendingCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens WHERE staff_id = ?').bind(receptionId).first();
    expect(pendingCount.n).toBe(0);
    expect((await probe(adminToken)).staffId).toBe(adminId);
    expect((await probe(managerAToken)).staffId).toBe(managerAId);

    const loginRes = await login({ request: new Request('https://x/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'le_tan_a', password: 'MatKhauMoi123' }) }), env });
    expect(loginRes.status).toBe(200);
    const newToken = /session=([^;]+)/.exec(loginRes.headers.get('Set-Cookie'))[1];
    expect((await probe(newToken)).staffId).toBe(receptionId);
  });
});

