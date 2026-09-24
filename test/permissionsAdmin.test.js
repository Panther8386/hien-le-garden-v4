import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getPermissions } from '../functions/api/permissions.js';
import { onRequestPut as putRolePermissions } from '../functions/api/roles/[role]/permissions.js';
import { onRequestGet as getUserPermissions, onRequestPut as putUserPermissions } from '../functions/api/users/[id]/permissions.js';
import { onRequestPost as lockUser } from '../functions/api/users/[id]/lock.js';
import { onRequestPost as unlockUser } from '../functions/api/users/[id]/unlock.js';
import { onRequestPatch as changeRole } from '../functions/api/users/[id]/role.js';
import { onRequestDelete as deleteUser } from '../functions/api/users/[id].js';
import { onRequestPatch as resetPassword } from '../functions/api/users/[id]/password.js';
import { onRequestPatch as adminDisable2fa } from '../functions/api/users/[id]/disable-2fa.js';
import { createSession, getSession, verifyPassword } from '../lib/auth.js';
import { requireAuth } from '../lib/requireAuth.js';
import { isLastActiveAdmin } from '../lib/staffGuards.js';
import { setOverride } from './helpers/permissions.js';

let qtId, qt2Id, qlId, ltId, qsId, qtToken, qlToken, ltToken;

async function insertStaff(username, role) {
  const r = await env.DB.prepare(
    `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES (?, 'x', ?, '2026-08-01T00:00:00Z')`
  ).bind(username, role).run();
  return r.meta.last_row_id;
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM user_permission_overrides');
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM audit_log');

  qtId = await insertStaff('qt', 'admin');
  qt2Id = await insertStaff('qt2', 'admin');
  qlId = await insertStaff('ql', 'manager');
  ltId = await insertStaff('lt', 'reception');
  qsId = await insertStaff('qs', 'observer');
  qtToken = await createSession(env.DB, qtId);
  qlToken = await createSession(env.DB, qlId);
  ltToken = await createSession(env.DB, ltId);
});

function authedRequest(url, token, method, body) {
  return new Request(url, {
    method,
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

async function rolePerms(role) {
  const { results } = await env.DB.prepare('SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission').bind(role).all();
  return results.map((r) => r.permission);
}

async function overridesOf(staffId) {
  const { results } = await env.DB.prepare('SELECT permission, effect FROM user_permission_overrides WHERE staff_id = ? ORDER BY permission').bind(staffId).all();
  return results;
}

async function auditRow(actionType) {
  return env.DB.prepare('SELECT * FROM audit_log WHERE action_type = ? ORDER BY id DESC LIMIT 1').bind(actionType).first();
}

const putRole = (token, role, body) =>
  putRolePermissions({ request: authedRequest(`https://x/api/roles/${role}/permissions`, token, 'PUT', body), env, params: { role } });
const putUser = (token, id, body) =>
  putUserPermissions({ request: authedRequest(`https://x/api/users/${id}/permissions`, token, 'PUT', body), env, params: { id: String(id) } });
const patchRole = (token, id, role) =>
  changeRole({ request: authedRequest(`https://x/api/users/${id}/role`, token, 'PATCH', { role }), env, params: { id: String(id) } });
const lock = (token, id) =>
  lockUser({ request: authedRequest(`https://x/api/users/${id}/lock`, token, 'POST'), env, params: { id: String(id) } });
const unlock = (token, id) =>
  unlockUser({ request: authedRequest(`https://x/api/users/${id}/unlock`, token, 'POST'), env, params: { id: String(id) } });
const del = (token, id) =>
  deleteUser({ request: authedRequest(`https://x/api/users/${id}`, token, 'DELETE'), env, params: { id: String(id) } });

describe('GET /api/permissions', () => {
  it('lets a manager read groups and role permissions, without role editing', async () => {
    const response = await getPermissions({ request: authedRequest('https://x/api/permissions', qlToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canEditRoles).toBe(false);
    expect(body.roles.observer).toEqual(['bookings.view', 'finance.view_income']);
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups.length).toBeGreaterThan(0);
    expect(Object.keys(body.roles).sort()).toEqual(['manager', 'observer', 'reception']);
  });

  it('tells an admin it can edit roles', async () => {
    const response = await getPermissions({ request: authedRequest('https://x/api/permissions', qtToken, 'GET'), env });
    expect(response.status).toBe(200);
    expect((await response.json()).canEditRoles).toBe(true);
  });

  it('rejects a reception account (403)', async () => {
    const response = await getPermissions({ request: authedRequest('https://x/api/permissions', ltToken, 'GET'), env });
    expect(response.status).toBe(403);
  });
});

describe('PUT /api/roles/:role/permissions', () => {
  it('lets an admin replace a role permission list and audits the sorted old/new lists', async () => {
    const response = await putRole(qtToken, 'observer', { permissions: ['bookings.view', 'finance.view_income', 'assets.view'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await rolePerms('observer')).toEqual(['assets.view', 'bookings.view', 'finance.view_income']);

    const row = await auditRow('role_permissions_change');
    expect(row.entity_type).toBe('role');
    expect(row.entity_label).toBe('observer');
    expect(row.old_value).toBe('bookings.view,finance.view_income');
    expect(row.new_value).toBe('assets.view,bookings.view,finance.view_income');
    expect(row.actor).toBe('qt');
  });

  it('rejects a manager (403)', async () => {
    const response = await putRole(qlToken, 'observer', { permissions: ['bookings.view'] });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('Không đủ quyền');
    expect(await rolePerms('observer')).toEqual(['bookings.view', 'finance.view_income']);
    expect(await auditRow('role_permissions_change')).toBeNull();
  });

  it('rejects editing the admin role (400)', async () => {
    const response = await putRole(qtToken, 'admin', { permissions: ['bookings.view'] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Không thể sửa quyền của vai trò quản trị');
    expect(await rolePerms('admin')).toEqual([]);
  });

  it('rejects an unknown role (400)', async () => {
    const response = await putRole(qtToken, 'boss', { permissions: ['bookings.view'] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Vai trò không hợp lệ');
    expect(await rolePerms('boss')).toEqual([]);
  });

  it('rejects an invalid permission key without changing role_permissions (400)', async () => {
    const response = await putRole(qtToken, 'observer', { permissions: ['bookings.view', 'bookings.fly'] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Mã quyền không hợp lệ: bookings.fly');
    expect(await rolePerms('observer')).toEqual(['bookings.view', 'finance.view_income']);
    expect(await auditRow('role_permissions_change')).toBeNull();
  });

  it('rejects a body whose permissions is not an array (400)', async () => {
    const response = await putRole(qtToken, 'observer', { permissions: 'bookings.view' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Dữ liệu không hợp lệ');
    expect(await rolePerms('observer')).toEqual(['bookings.view', 'finance.view_income']);
  });
});

describe('PUT /api/users/:id/permissions', () => {
  it('lets a manager set overrides for a reception account and audits them', async () => {
    const response = await putUser(qlToken, ltId, { overrides: { 'finance.create': 'grant', 'customers.send': 'deny' } });
    expect(response.status).toBe(200);
    expect(await overridesOf(ltId)).toEqual([
      { permission: 'customers.send', effect: 'deny' },
      { permission: 'finance.create', effect: 'grant' },
    ]);

    const row = await auditRow('user_permissions_change');
    expect(row.entity_type).toBe('staff_account');
    expect(row.entity_id).toBe(ltId);
    expect(row.entity_label).toBe('lt');
    expect(row.old_value).toBe('');
    expect(row.new_value).toBe('customers.send:deny,finance.create:grant');
    expect(row.actor).toBe('ql');
  });

  it('rejects a manager granting a permission they do not have (403)', async () => {
    const response = await putUser(qlToken, ltId, { overrides: { 'users.security': 'grant' } });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('Không thể cấp quyền mà bạn không có: users.security');
    expect(await overridesOf(ltId)).toEqual([]);
    expect(await auditRow('user_permissions_change')).toBeNull();
  });

  it('lets a manager deny a permission they do not have', async () => {
    const response = await putUser(qlToken, ltId, { overrides: { 'users.security': 'deny' } });
    expect(response.status).toBe(200);
    expect(await overridesOf(ltId)).toEqual([{ permission: 'users.security', effect: 'deny' }]);
  });

  it('rejects editing your own overrides (400)', async () => {
    const response = await putUser(qlToken, qlId, { overrides: { 'assets.delete': 'deny' } });
    expect(response.status).toBe(400);
    expect(await overridesOf(qlId)).toEqual([]);
  });

  it('rejects a manager editing an admin account (403)', async () => {
    const response = await putUser(qlToken, qtId, { overrides: { 'assets.delete': 'deny' } });
    expect(response.status).toBe(403);
    expect(await overridesOf(qtId)).toEqual([]);
  });

  it('rejects overrides on an admin account even from another admin (400)', async () => {
    const response = await putUser(qtToken, qt2Id, { overrides: { 'assets.delete': 'deny' } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Tài khoản quản trị luôn có toàn quyền, không chỉnh riêng');
    expect(await overridesOf(qt2Id)).toEqual([]);
  });

  it('rejects an invalid permission key (400)', async () => {
    const response = await putUser(qlToken, ltId, { overrides: { 'bookings.fly': 'grant' } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Mã quyền không hợp lệ: bookings.fly');
    expect(await overridesOf(ltId)).toEqual([]);
  });

  it('rejects an effect other than grant/deny (400)', async () => {
    const response = await putUser(qlToken, ltId, { overrides: { 'assets.delete': 'maybe' } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Dữ liệu không hợp lệ');
    expect(await overridesOf(ltId)).toEqual([]);
  });

  it('clears all overrides when sent an empty object', async () => {
    await setOverride(env.DB, ltId, 'assets.delete', 'grant');
    await setOverride(env.DB, ltId, 'customers.send', 'deny');
    const response = await putUser(qlToken, ltId, { overrides: {} });
    expect(response.status).toBe(200);
    expect(await overridesOf(ltId)).toEqual([]);
    const row = await auditRow('user_permissions_change');
    expect(row.old_value).toBe('assets.delete:grant,customers.send:deny');
    expect(row.new_value).toBe('');
  });
});

describe('GET /api/users/:id/permissions', () => {
  it('returns role, overrides and effective permissions', async () => {
    // Quản lý không có assets.delete nên không cấp được; quản trị cấp.
    expect((await putUser(qtToken, ltId, { overrides: { 'assets.delete': 'grant' } })).status).toBe(200);
    const response = await getUserPermissions({ request: authedRequest(`https://x/api/users/${ltId}/permissions`, qlToken, 'GET'), env, params: { id: String(ltId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.role).toBe('reception');
    expect(body.overrides).toEqual({ 'assets.delete': 'grant' });
    expect(body.effective).toContain('assets.delete');
    expect(body.effective).toContain('bookings.view');
  });

  it('returns 404 for a nonexistent account', async () => {
    const response = await getUserPermissions({ request: authedRequest('https://x/api/users/999999/permissions', qlToken, 'GET'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects a reception account (403)', async () => {
    const response = await getUserPermissions({ request: authedRequest(`https://x/api/users/${qsId}/permissions`, ltToken, 'GET'), env, params: { id: String(qsId) } });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('clears the target overrides when the role changes', async () => {
    await setOverride(env.DB, ltId, 'assets.delete', 'grant');
    const response = await patchRole(qlToken, ltId, 'observer');
    expect(response.status).toBe(200);
    expect(await overridesOf(ltId)).toEqual([]);
    const row = await env.DB.prepare('SELECT role FROM staff_accounts WHERE id = ?').bind(ltId).first();
    expect(row.role).toBe('observer');

    const token = await createSession(env.DB, ltId);
    const session = await getSession(env.DB, token);
    expect(session.role).toBe('observer');
    expect(session.permissions.has('assets.delete')).toBe(false);

    const audit = await auditRow('account_role_change');
    expect(audit.old_value).toBe('reception');
    expect(audit.new_value).toBe('observer');
  });

  it('rejects a manager assigning the admin role (403)', async () => {
    const response = await patchRole(qlToken, ltId, 'admin');
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('Chỉ quản trị mới được gán vai trò quản trị');
    const row = await env.DB.prepare('SELECT role FROM staff_accounts WHERE id = ?').bind(ltId).first();
    expect(row.role).toBe('reception');
  });

  it('rejects a manager changing an admin account role (403)', async () => {
    const response = await patchRole(qlToken, qtId, 'manager');
    expect(response.status).toBe(403);
    const row = await env.DB.prepare('SELECT role FROM staff_accounts WHERE id = ?').bind(qtId).first();
    expect(row.role).toBe('admin');
  });

  it('lets an admin demote another admin while an active admin remains', async () => {
    const response = await patchRole(qtToken, qt2Id, 'manager');
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT role FROM staff_accounts WHERE id = ?').bind(qt2Id).first();
    expect(row.role).toBe('manager');
  });

  it('rejects a manager changing their own role (400)', async () => {
    const response = await patchRole(qlToken, qlId, 'reception');
    expect(response.status).toBe(400);
    const row = await env.DB.prepare('SELECT role FROM staff_accounts WHERE id = ?').bind(qlId).first();
    expect(row.role).toBe('manager');
  });

  it('rejects an admin changing their own role (400)', async () => {
    const response = await patchRole(qtToken, qtId, 'manager');
    expect(response.status).toBe(400);
    const row = await env.DB.prepare('SELECT role FROM staff_accounts WHERE id = ?').bind(qtId).first();
    expect(row.role).toBe('admin');
  });
});

describe('isLastActiveAdmin', () => {
  it('is false while another active admin exists', async () => {
    expect(await isLastActiveAdmin(env.DB, qtId)).toBe(false);
  });

  it('accounts for locked admins and non-admin targets', async () => {
    await env.DB.prepare('UPDATE staff_accounts SET locked_at = ? WHERE id = ?').bind('2026-09-24T00:00:00Z', qt2Id).run();
    expect(await isLastActiveAdmin(env.DB, qtId)).toBe(true);
    expect(await isLastActiveAdmin(env.DB, qt2Id)).toBe(false);
    expect(await isLastActiveAdmin(env.DB, ltId)).toBe(false);
  });
});

describe('POST /api/users/:id/lock and /unlock', () => {
  it('locks an account, drops its sessions and audits the lock', async () => {
    await createSession(env.DB, ltId);
    const response = await lock(qlToken, ltId);
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT locked_at, locked_by FROM staff_accounts WHERE id = ?').bind(ltId).first();
    expect(row.locked_at).toBeTruthy();
    expect(row.locked_by).toBe('ql');
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE staff_id = ?').bind(ltId).first();
    expect(n).toBe(0);

    const auth = await requireAuth(authedRequest('https://x/api/bookings', ltToken, 'GET'), env);
    expect(auth).toBeInstanceOf(Response);
    expect(auth.status).toBe(401);

    const audit = await auditRow('account_lock');
    expect(audit.entity_type).toBe('staff_account');
    expect(audit.entity_id).toBe(ltId);
    expect(audit.entity_label).toBe('lt');
    expect(audit.actor).toBe('ql');
  });

  it('rejects locking twice, unlocks, and rejects unlocking an unlocked account', async () => {
    expect((await lock(qlToken, ltId)).status).toBe(200);

    const again = await lock(qlToken, ltId);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe('Tài khoản đã bị khoá');

    const opened = await unlock(qlToken, ltId);
    expect(opened.status).toBe(200);
    const row = await env.DB.prepare('SELECT locked_at, locked_by FROM staff_accounts WHERE id = ?').bind(ltId).first();
    expect(row.locked_at).toBeNull();
    expect(row.locked_by).toBeNull();
    const audit = await auditRow('account_unlock');
    expect(audit.entity_label).toBe('lt');
    expect(audit.actor).toBe('ql');

    const notLocked = await unlock(qlToken, ltId);
    expect(notLocked.status).toBe(400);
    expect((await notLocked.json()).error).toBe('Tài khoản không bị khoá');
  });

  it('rejects a manager locking an admin (403)', async () => {
    const response = await lock(qlToken, qtId);
    expect(response.status).toBe(403);
    const row = await env.DB.prepare('SELECT locked_at FROM staff_accounts WHERE id = ?').bind(qtId).first();
    expect(row.locked_at).toBeNull();
  });

  it('rejects a manager unlocking an admin (403)', async () => {
    await env.DB.prepare('UPDATE staff_accounts SET locked_at = ?, locked_by = ? WHERE id = ?').bind('2026-09-24T00:00:00Z', 'qt', qt2Id).run();
    const response = await unlock(qlToken, qt2Id);
    expect(response.status).toBe(403);
    const row = await env.DB.prepare('SELECT locked_at FROM staff_accounts WHERE id = ?').bind(qt2Id).first();
    expect(row.locked_at).not.toBeNull();
  });

  it('rejects locking yourself (400)', async () => {
    const response = await lock(qlToken, qlId);
    expect(response.status).toBe(400);
    const row = await env.DB.prepare('SELECT locked_at FROM staff_accounts WHERE id = ?').bind(qlId).first();
    expect(row.locked_at).toBeNull();
  });

  it('rejects an admin locking themselves (400)', async () => {
    const response = await lock(qtToken, qtId);
    expect(response.status).toBe(400);
  });

  it('lets an admin lock another admin while they stay active', async () => {
    const response = await lock(qtToken, qt2Id);
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT locked_at, locked_by FROM staff_accounts WHERE id = ?').bind(qt2Id).first();
    expect(row.locked_at).toBeTruthy();
    expect(row.locked_by).toBe('qt');
  });

  it('rejects a reception account (403)', async () => {
    const response = await lock(ltToken, qsId);
    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent account', async () => {
    const response = await lock(qlToken, 999999);
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/users/:id', () => {
  it('deletes an account together with its overrides', async () => {
    await setOverride(env.DB, ltId, 'assets.delete', 'grant');
    const response = await del(qlToken, ltId);
    expect(response.status).toBe(204);
    expect(await overridesOf(ltId)).toEqual([]);
    const row = await env.DB.prepare('SELECT id FROM staff_accounts WHERE id = ?').bind(ltId).first();
    expect(row).toBeNull();
    const audit = await auditRow('account_delete');
    expect(audit.entity_label).toBe('lt');
  });

  it('rejects a manager deleting an admin (403)', async () => {
    const response = await del(qlToken, qtId);
    expect(response.status).toBe(403);
    const row = await env.DB.prepare('SELECT id FROM staff_accounts WHERE id = ?').bind(qtId).first();
    expect(row).not.toBeNull();
  });

  it('rejects an admin deleting themselves (400)', async () => {
    const response = await del(qtToken, qtId);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Không thể tự xoá tài khoản của chính mình');
  });

  it('lets an admin delete another admin while they stay active', async () => {
    const response = await del(qtToken, qt2Id);
    expect(response.status).toBe(204);
  });
});

describe('password and disable-2fa', () => {
  it('rejects a manager resetting a password (403)', async () => {
    const response = await resetPassword({ request: authedRequest(`https://x/api/users/${ltId}/password`, qlToken, 'PATCH', { password: 'MatKhauMoi123' }), env, params: { id: String(ltId) } });
    expect(response.status).toBe(403);
  });

  it('lets an admin reset a reception password', async () => {
    const response = await resetPassword({ request: authedRequest(`https://x/api/users/${ltId}/password`, qtToken, 'PATCH', { password: 'MatKhauMoi123' }), env, params: { id: String(ltId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT password_hash FROM staff_accounts WHERE id = ?').bind(ltId).first();
    expect(await verifyPassword('MatKhauMoi123', row.password_hash)).toBe(true);
  });

  it('lets an admin reset another admin password', async () => {
    const response = await resetPassword({ request: authedRequest(`https://x/api/users/${qt2Id}/password`, qtToken, 'PATCH', { password: 'MatKhauMoi123' }), env, params: { id: String(qt2Id) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT password_hash FROM staff_accounts WHERE id = ?').bind(qt2Id).first();
    expect(await verifyPassword('MatKhauMoi123', row.password_hash)).toBe(true);
    const audit = await auditRow('account_password_reset');
    expect(audit.entity_label).toBe('qt2');
  });

  it('rejects a manager disabling 2FA (403)', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET totp_enabled = 1, totp_secret = 'ABC' WHERE id = ?`).bind(ltId).run();
    const response = await adminDisable2fa({ request: authedRequest(`https://x/api/users/${ltId}/disable-2fa`, qlToken, 'PATCH'), env, params: { id: String(ltId) } });
    expect(response.status).toBe(403);
    const row = await env.DB.prepare('SELECT totp_enabled FROM staff_accounts WHERE id = ?').bind(ltId).first();
    expect(row.totp_enabled).toBe(1);
  });

  it('lets an admin disable 2FA for another account', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET totp_enabled = 1, totp_secret = 'ABC' WHERE id = ?`).bind(qt2Id).run();
    const response = await adminDisable2fa({ request: authedRequest(`https://x/api/users/${qt2Id}/disable-2fa`, qtToken, 'PATCH'), env, params: { id: String(qt2Id) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT totp_enabled, totp_secret FROM staff_accounts WHERE id = ?').bind(qt2Id).first();
    expect(row.totp_enabled).toBe(0);
    expect(row.totp_secret).toBeNull();
    const audit = await auditRow('2fa_admin_disable');
    expect(audit.entity_label).toBe('qt2');
  });
});
