import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getSession, createSession, hashPassword } from '../lib/auth.js';
import { requireAuth } from '../lib/requireAuth.js';
import { onRequestGet as me } from '../functions/api/auth/me.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { PERMISSION_KEYS } from '../lib/permissions.js';
import { setOverride, setRolePermissions } from './helpers/permissions.js';

let receptionId, adminId, observerId;
beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  const hash = await hashPassword('s3cret-pass');
  receptionId = (await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('lt', ?, 'reception', '2026-09-24T00:00:00Z')`).bind(hash).run()).meta.last_row_id;
  adminId = (await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('qt', ?, 'admin', '2026-09-24T00:00:00Z')`).bind(hash).run()).meta.last_row_id;
  observerId = (await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('qs', ?, 'observer', '2026-09-24T00:00:00Z')`).bind(hash).run()).meta.last_row_id;
});

const req = (token) => new Request('https://x/api/test', { headers: token ? { Cookie: `session=${token}` } : {} });

describe('getSession permissions', () => {
  it('loads the role set plus overrides', async () => {
    await setOverride(env.DB, receptionId, 'assets.delete', 'grant');
    await setOverride(env.DB, receptionId, 'customers.send', 'deny');
    const s = await getSession(env.DB, await createSession(env.DB, receptionId));
    expect(s.permissions.has('bookings.manage')).toBe(true);
    expect(s.permissions.has('assets.delete')).toBe(true);
    expect(s.permissions.has('customers.send')).toBe(false);
  });

  it('gives admin every permission', async () => {
    const s = await getSession(env.DB, await createSession(env.DB, adminId));
    expect(s.permissions.size).toBe(PERMISSION_KEYS.length);
  });

  it('picks up role-table edits on the next request', async () => {
    const token = await createSession(env.DB, observerId);
    await setRolePermissions(env.DB, 'observer', ['bookings.view', 'finance.view_income', 'assets.view']);
    expect((await getSession(env.DB, token)).permissions.has('assets.view')).toBe(true);
  });

  it('returns null for a locked account even with a live session', async () => {
    const token = await createSession(env.DB, receptionId);
    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-24T01:00:00Z', locked_by = 'qt' WHERE id = ?`).bind(receptionId).run();
    expect(await getSession(env.DB, token)).toBeNull();
  });
});

describe('requireAuth with a permission key', () => {
  it('401s without a session', async () => {
    const r = await requireAuth(req(null), env, 'bookings.view');
    expect(r.status).toBe(401);
  });

  it('403s when the permission is missing', async () => {
    const r = await requireAuth(req(await createSession(env.DB, observerId)), env, 'assets.view');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Không đủ quyền' });
  });

  it('returns the session when the permission is present', async () => {
    const r = await requireAuth(req(await createSession(env.DB, observerId)), env, 'bookings.view');
    expect(r.username).toBe('qs');
  });

  it('throws on a legacy role array so a missed conversion fails loudly', async () => {
    await expect(requireAuth(req(await createSession(env.DB, observerId)), env, ['observer'])).rejects.toThrow(TypeError);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the sorted permission list', async () => {
    const res = await me({ request: req(await createSession(env.DB, observerId)), env });
    const body = await res.json();
    expect(body.permissions).toEqual(['bookings.view', 'finance.view_income']);
    expect(body).not.toHaveProperty('canManageRoomLayout');
  });
});

describe('POST /api/auth/login on a locked account', () => {
  it('403s with the lock message and creates no session', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-24T01:00:00Z' WHERE id = ?`).bind(receptionId).run();
    const res = await login({ request: new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'lt', password: 's3cret-pass' }) }), env });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Tài khoản đang bị khoá. Liên hệ quản trị.' });
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first();
    expect(n).toBe(0);
  });

  it('checks the password first, so a wrong password on a locked account still says 401', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-24T01:00:00Z' WHERE id = ?`).bind(receptionId).run();
    const res = await login({ request: new Request('https://x/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'lt', password: 'wrong-pass' }) }), env });
    expect(res.status).toBe(401);
  });
});
