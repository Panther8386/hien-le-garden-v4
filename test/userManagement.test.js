import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestDelete as deleteUser } from '../functions/api/users/[id].js';
import { onRequestPatch as changeRole } from '../functions/api/users/[id]/role.js';
import { onRequestPatch as setRoomLayoutAccess } from '../functions/api/users/[id]/room-layout-access.js';
import { onRequestPatch as resetPassword } from '../functions/api/users/[id]/password.js';
import { createSession, verifyPassword } from '../lib/auth.js';

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

  it('deleting a manager always leaves at least one manager, since only a manager can delete another', async () => {
    // A deletes B: A can never delete itself, so the acting manager always remains — the
    // count can never reach zero this way. This is why DELETE needs no separate "last
    // manager" count guard; see the implementation note below Step 3 for the full argument.
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, managerAToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(204);

    const managerCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'manager'`).first();
    expect(managerCount.n).toBe(1);
  });

  it('rejects a reception account (403)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, receptionToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('lets a manager change another account role', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'manager' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(receptionId).first();
    expect(row.role).toBe('manager');
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

  it('rejects demoting the last manager (400)', async () => {
    await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, managerAToken, 'DELETE'), env, params: { id: String(managerBId) } });
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerAId}/role`, managerAToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(400);
  });

  it('rejects a reception account (403)', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerBId}/role`, receptionToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/users/:id/room-layout-access', () => {
  it('lets a manager grant the flag', async () => {
    const request = authedRequest(`https://x/api/users/${receptionId}/room-layout-access`, managerAToken, 'PATCH', { canManageRoomLayout: true });
    const response = await setRoomLayoutAccess({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT can_manage_room_layout FROM staff_accounts WHERE id = ?`).bind(receptionId).first();
    expect(row.can_manage_room_layout).toBe(1);
  });

  it('lets a manager revoke the flag', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET can_manage_room_layout = 1 WHERE id = ?`).bind(receptionId).run();
    const request = authedRequest(`https://x/api/users/${receptionId}/room-layout-access`, managerAToken, 'PATCH', { canManageRoomLayout: false });
    const response = await setRoomLayoutAccess({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT can_manage_room_layout FROM staff_accounts WHERE id = ?`).bind(receptionId).first();
    expect(row.can_manage_room_layout).toBe(0);
  });

  it('rejects a reception account (403)', async () => {
    const request = authedRequest(`https://x/api/users/${managerBId}/room-layout-access`, receptionToken, 'PATCH', { canManageRoomLayout: true });
    const response = await setRoomLayoutAccess({ request, env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });

  it('returns 404 for a nonexistent account', async () => {
    const request = authedRequest('https://x/api/users/999999/room-layout-access', managerAToken, 'PATCH', { canManageRoomLayout: true });
    const response = await setRoomLayoutAccess({ request, env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects a non-boolean value (400)', async () => {
    const request = authedRequest(`https://x/api/users/${receptionId}/room-layout-access`, managerAToken, 'PATCH', { canManageRoomLayout: 'yes' });
    const response = await setRoomLayoutAccess({ request, env, params: { id: String(receptionId) } });
    expect(response.status).toBe(400);
  });

  it('rejects granting the flag to an observer account (400)', async () => {
    const request = authedRequest(`https://x/api/users/${observerId}/room-layout-access`, managerAToken, 'PATCH', { canManageRoomLayout: true });
    const response = await setRoomLayoutAccess({ request, env, params: { id: String(observerId) } });
    expect(response.status).toBe(400);
    const row = await env.DB.prepare(`SELECT can_manage_room_layout FROM staff_accounts WHERE id = ?`).bind(observerId).first();
    expect(row.can_manage_room_layout).toBe(0);
  });

  it('lets a manager revoke the flag on an observer account even though granting is blocked', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET can_manage_room_layout = 1 WHERE id = ?`).bind(observerId).run();
    const request = authedRequest(`https://x/api/users/${observerId}/room-layout-access`, managerAToken, 'PATCH', { canManageRoomLayout: false });
    const response = await setRoomLayoutAccess({ request, env, params: { id: String(observerId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT can_manage_room_layout FROM staff_accounts WHERE id = ?`).bind(observerId).first();
    expect(row.can_manage_room_layout).toBe(0);
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
});
