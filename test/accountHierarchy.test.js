// FA-1: thứ bậc tài khoản — người không phải admin chỉ thao tác được trên tài khoản
// có cấp thấp hơn mình (admin 3 > manager 2 > reception = observer 1), bất kể quyền
// users.* được cấp riêng. Khoá do admin chỉ admin mở được.
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPut as putUserPermissions } from '../functions/api/users/[id]/permissions.js';
import { onRequestPost as lockUser } from '../functions/api/users/[id]/lock.js';
import { onRequestPost as unlockUser } from '../functions/api/users/[id]/unlock.js';
import { onRequestPatch as changeRole } from '../functions/api/users/[id]/role.js';
import { onRequestDelete as deleteUser } from '../functions/api/users/[id].js';
import { onRequestPost as createUser } from '../functions/api/users/index.js';
import { onRequestPatch as resetPassword } from '../functions/api/users/[id]/password.js';
import { onRequestPatch as disable2fa } from '../functions/api/users/[id]/disable-2fa.js';
import { createSession } from '../lib/auth.js';
import { PERMISSION_KEYS } from '../lib/permissions.js';
import { setOverride } from './helpers/permissions.js';

const HIERARCHY = 'Không thể thao tác trên tài khoản cùng cấp hoặc cấp cao hơn';
const ADMIN_TARGET = 'Chỉ quản trị mới được sửa tài khoản quản trị';
const ADMIN_LOCK = 'Tài khoản bị quản trị viên khoá, chỉ quản trị viên mới mở khoá được';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

let A, M1, M2, R, O;
let aTok, m1Tok, m2Tok, rTok;

async function insertStaff(username, role) {
  const r = await env.DB.prepare(
    `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES (?, 'x', ?, '2026-08-01T00:00:00Z')`
  ).bind(username, role).run();
  return r.meta.last_row_id;
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM user_permission_overrides');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM audit_log');
  A = await insertStaff('qt', 'admin');
  M1 = await insertStaff('ql1', 'manager');
  M2 = await insertStaff('ql2', 'manager');
  R = await insertStaff('lt', 'reception');
  O = await insertStaff('qs', 'observer');
  aTok = await createSession(env.DB, A);
  m1Tok = await createSession(env.DB, M1);
  m2Tok = await createSession(env.DB, M2);
  rTok = await createSession(env.DB, R);
  // Mọi tài khoản bật 2FA để disable-2fa đi tới được bước ghi.
  await env.DB.prepare('UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1').bind(SECRET).run();
});

function req(url, token, method, body) {
  return new Request(url, {
    method,
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const p = (id) => ({ id: String(id) });
const api = {
  lock: (t, id) => lockUser({ request: req(`https://x/api/users/${id}/lock`, t, 'POST'), env, params: p(id) }),
  unlock: (t, id) => unlockUser({ request: req(`https://x/api/users/${id}/unlock`, t, 'POST'), env, params: p(id) }),
  role: (t, id, role) => changeRole({ request: req(`https://x/api/users/${id}/role`, t, 'PATCH', { role }), env, params: p(id) }),
  overrides: (t, id, overrides) => putUserPermissions({ request: req(`https://x/api/users/${id}/permissions`, t, 'PUT', { overrides }), env, params: p(id) }),
  del: (t, id) => deleteUser({ request: req(`https://x/api/users/${id}`, t, 'DELETE'), env, params: p(id) }),
  password: (t, id) => resetPassword({ request: req(`https://x/api/users/${id}/password`, t, 'PATCH', { password: 'MatKhauMoi123' }), env, params: p(id) }),
  disable2fa: (t, id) => disable2fa({ request: req(`https://x/api/users/${id}/disable-2fa`, t, 'PATCH'), env, params: p(id) }),
  create: (t, body) => createUser({ request: req('https://x/api/users', t, 'POST', body), env }),
};

async function snapshot() {
  const accounts = (await env.DB.prepare(
    'SELECT id, username, role, password_hash, totp_enabled, totp_secret, locked_at, locked_by FROM staff_accounts ORDER BY id'
  ).all()).results;
  const overrides = (await env.DB.prepare('SELECT staff_id, permission, effect FROM user_permission_overrides ORDER BY staff_id, permission').all()).results;
  const audit = (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first()).n;
  const sessions = (await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n;
  return { accounts, overrides, audit, sessions };
}

async function expectDenied(promise, message = HIERARCHY) {
  const before = await snapshot();
  const response = await promise();
  expect(response.status).toBe(403);
  expect((await response.json()).error).toBe(message);
  expect(await snapshot()).toEqual(before);
}

async function lockAs(actorUsername, targetId) {
  await env.DB.prepare('UPDATE staff_accounts SET locked_at = ?, locked_by = ? WHERE id = ?')
    .bind('2026-09-01T00:00:00Z', actorUsername, targetId).run();
}
const roleOf = async (id) => (await env.DB.prepare('SELECT role FROM staff_accounts WHERE id = ?').bind(id).first())?.role;

describe('manager acting on lower-ranked accounts (allowed as today)', () => {
  for (const [name, getId] of [['reception', () => R], ['observer', () => O]]) {
    it(`lets M1 lock, unlock, change role, set overrides and delete a ${name}`, async () => {
      const id = getId();
      expect((await api.lock(m1Tok, id)).status).toBe(200);
      expect((await api.unlock(m1Tok, id)).status).toBe(200);
      expect((await api.overrides(m1Tok, id, { 'customers.send': 'deny' })).status).toBe(200);
      const newRole = name === 'reception' ? 'observer' : 'reception';
      expect((await api.role(m1Tok, id, newRole)).status).toBe(200);
      expect(await roleOf(id)).toBe(newRole);
      expect((await api.del(m1Tok, id)).status).toBe(204);
      expect(await roleOf(id)).toBeUndefined();
    });
  }
});

describe('manager acting on another manager (403, nothing written)', () => {
  beforeEach(async () => {
    await setOverride(env.DB, M1, 'users.security', 'grant');
  });

  it('rejects lock', () => expectDenied(() => api.lock(m1Tok, M2)));
  it('rejects unlock', async () => {
    await lockAs('qt', M2);
    await expectDenied(() => api.unlock(m1Tok, M2));
  });
  it('rejects unlock of a manager M1 itself locked (same rank)', async () => {
    await lockAs('ql1', M2);
    await expectDenied(() => api.unlock(m1Tok, M2));
  });
  it('rejects role change (demotion)', () => expectDenied(() => api.role(m1Tok, M2, 'reception')));
  it('rejects role change to the same role', () => expectDenied(() => api.role(m1Tok, M2, 'manager')));
  it('rejects adding a deny override', () => expectDenied(() => api.overrides(m1Tok, M2, { 'finance.manage': 'deny' })));
  it('rejects removing a deny override', async () => {
    await setOverride(env.DB, M2, 'customers.send', 'deny');
    await expectDenied(() => api.overrides(m1Tok, M2, {}));
  });
  it('rejects delete', () => expectDenied(() => api.del(m1Tok, M2)));
  it('rejects password reset (M1 holds users.security)', () => expectDenied(() => api.password(m1Tok, M2)));
  it('rejects disabling 2FA (M1 holds users.security)', () => expectDenied(() => api.disable2fa(m1Tok, M2)));
});

describe('manager acting on an admin (existing admin-target rule)', () => {
  it('rejects every mutation with the admin-target message', async () => {
    await setOverride(env.DB, M1, 'users.security', 'grant');
    await expectDenied(() => api.lock(m1Tok, A), ADMIN_TARGET);
    await expectDenied(() => api.role(m1Tok, A, 'manager'), ADMIN_TARGET);
    await expectDenied(() => api.overrides(m1Tok, A, {}), ADMIN_TARGET);
    await expectDenied(() => api.del(m1Tok, A), ADMIN_TARGET);
    await expectDenied(() => api.password(m1Tok, A), ADMIN_TARGET);
    await expectDenied(() => api.disable2fa(m1Tok, A), ADMIN_TARGET);
  });
});

describe('reception granted users.manage / users.security', () => {
  beforeEach(async () => {
    await setOverride(env.DB, R, 'users.manage', 'grant');
    await setOverride(env.DB, R, 'users.security', 'grant');
  });

  it('cannot lock, change role, edit overrides or delete a manager', async () => {
    await expectDenied(() => api.lock(rTok, M1));
    await expectDenied(() => api.role(rTok, M1, 'observer'));
    await expectDenied(() => api.overrides(rTok, M1, { 'finance.manage': 'deny' }));
    await expectDenied(() => api.del(rTok, M1));
  });

  it('cannot reset password or disable 2FA of a manager', async () => {
    await expectDenied(() => api.password(rTok, M1));
    await expectDenied(() => api.disable2fa(rTok, M1));
  });

  it('cannot act on an observer (same rank)', async () => {
    await expectDenied(() => api.lock(rTok, O));
    await expectDenied(() => api.role(rTok, O, 'reception'));
    await expectDenied(() => api.overrides(rTok, O, { 'bookings.view': 'deny' }));
    await expectDenied(() => api.del(rTok, O));
    await expectDenied(() => api.password(rTok, O));
    await expectDenied(() => api.disable2fa(rTok, O));
  });

  it('cannot create any account (no lower rank exists)', async () => {
    await expectDenied(() => api.create(rTok, { username: 'moi', password: 'password123', role: 'observer' }));
    await expectDenied(() => api.create(rTok, { username: 'moi', password: 'password123', role: 'reception' }));
  });
});

describe('manager granted users.security', () => {
  beforeEach(async () => {
    await setOverride(env.DB, M1, 'users.security', 'grant');
  });

  it('rejects password reset and disable-2fa on another manager', async () => {
    await expectDenied(() => api.password(m1Tok, M2));
    await expectDenied(() => api.disable2fa(m1Tok, M2));
  });

  it('allows password reset and disable-2fa on a reception account', async () => {
    const pw = await api.password(m1Tok, R);
    expect(pw.status).toBe(200);
    const d = await api.disable2fa(m1Tok, R);
    expect(d.status).toBe(200);
    const row = await env.DB.prepare('SELECT totp_enabled AS t, password_hash AS h FROM staff_accounts WHERE id = ?').bind(R).first();
    expect(row.t).toBe(0);
    expect(row.h).not.toBe('x');
  });
});

describe('unlocking an account locked by an admin', () => {
  it('rejects M1 unlocking a reception locked by admin A', async () => {
    await lockAs('qt', R);
    await expectDenied(() => api.unlock(m1Tok, R), ADMIN_LOCK);
  });

  it('lets M1 unlock a reception it locked itself', async () => {
    expect((await api.lock(m1Tok, R)).status).toBe(200);
    const response = await api.unlock(m1Tok, R);
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT locked_at AS l, locked_by AS b FROM staff_accounts WHERE id = ?').bind(R).first();
    expect(row).toEqual({ l: null, b: null });
  });

  it('treats a lock whose locker account was deleted as an admin lock', async () => {
    await lockAs('da_xoa', R);
    await expectDenied(() => api.unlock(m1Tok, R), ADMIN_LOCK);
    expect((await api.unlock(aTok, R)).status).toBe(200);
  });

  it('treats a lock with NULL locked_by as an admin lock', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-01T00:00:00Z', locked_by = NULL WHERE id = ?`).bind(R).run();
    await expectDenied(() => api.unlock(m1Tok, R), ADMIN_LOCK);
    expect((await api.unlock(aTok, R)).status).toBe(200);
  });

  it('lets an admin unlock an account locked by an admin', async () => {
    await lockAs('qt', M1);
    expect((await api.unlock(aTok, M1)).status).toBe(200);
  });
});

describe('role assignment and creation by a manager', () => {
  it('rejects creating a manager account', async () => {
    await expectDenied(() => api.create(m1Tok, { username: 'ql_moi', password: 'password123', role: 'manager' }));
  });

  it('allows creating a reception account', async () => {
    const response = await api.create(m1Tok, { username: 'lt_moi', password: 'password123', role: 'reception' });
    expect(response.status).toBe(201);
  });

  it('keeps the admin-role message when creating an admin', async () => {
    await expectDenied(() => api.create(m1Tok, { username: 'qt_moi', password: 'password123', role: 'admin' }), 'Chỉ quản trị mới được gán vai trò quản trị');
  });

  it('rejects promoting a reception account to manager', async () => {
    await expectDenied(() => api.role(m1Tok, R, 'manager'));
  });

  it('keeps the admin-role message when promoting to admin', async () => {
    await expectDenied(() => api.role(m1Tok, R, 'admin'), 'Chỉ quản trị mới được gán vai trò quản trị');
  });
});

describe('admin is unrestricted by the hierarchy', () => {
  it('can reset passwords, disable 2FA, set overrides and lock/unlock managers and lower', async () => {
    for (const id of [M1, M2, R, O]) {
      expect((await api.password(aTok, id)).status).toBe(200);
      expect((await api.disable2fa(aTok, id)).status).toBe(200);
      expect((await api.overrides(aTok, id, { 'bookings.view': 'deny' })).status).toBe(200);
      expect((await api.lock(aTok, id)).status).toBe(200);
      expect((await api.unlock(aTok, id)).status).toBe(200);
    }
  });

  it('can change roles to manager and admin, create managers, and delete', async () => {
    expect((await api.role(aTok, R, 'manager')).status).toBe(200);
    expect((await api.role(aTok, O, 'admin')).status).toBe(200);
    expect((await api.role(aTok, M2, 'reception')).status).toBe(200);
    expect((await api.create(aTok, { username: 'ql_moi', password: 'password123', role: 'manager' })).status).toBe(201);
    expect((await api.del(aTok, M1)).status).toBe(204);
  });
});

describe('permission overrides cannot bypass the hierarchy', () => {
  it('M1 holding every permission still gets 403 on M2 for every mutation', async () => {
    for (const key of PERMISSION_KEYS) await setOverride(env.DB, M1, key, 'grant');
    await lockAs('qt', M2);
    await expectDenied(() => api.unlock(m1Tok, M2));
    await env.DB.prepare('UPDATE staff_accounts SET locked_at = NULL, locked_by = NULL WHERE id = ?').bind(M2).run();
    await expectDenied(() => api.lock(m1Tok, M2));
    await expectDenied(() => api.role(m1Tok, M2, 'observer'));
    await expectDenied(() => api.overrides(m1Tok, M2, { 'bookings.view': 'deny' }));
    await expectDenied(() => api.del(m1Tok, M2));
    await expectDenied(() => api.password(m1Tok, M2));
    await expectDenied(() => api.disable2fa(m1Tok, M2));
    await expectDenied(() => api.create(m1Tok, { username: 'ql_moi', password: 'password123', role: 'manager' }));
  });
});

describe('self-handling is unchanged', () => {
  it('still lets a user disable their own 2FA through the admin endpoint when they hold users.security', async () => {
    await setOverride(env.DB, M1, 'users.security', 'grant');
    expect((await api.disable2fa(m1Tok, M1)).status).toBe(200);
  });

  it('still rejects self password reset (400) and self lock (400)', async () => {
    await setOverride(env.DB, M1, 'users.security', 'grant');
    expect((await api.password(m1Tok, M1)).status).toBe(400);
    expect((await api.lock(m1Tok, M1)).status).toBe(400);
  });
});
