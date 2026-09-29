import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as me } from '../functions/api/auth/me.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { hashPassword } from '../lib/auth.js';
import { ROLE_DEFAULTS } from '../lib/permissions.js';
import { setOverride } from './helpers/permissions.js';

let sharedPasswordHash;
beforeAll(async () => {
  sharedPasswordHash = await hashPassword('s3cret-pass');
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.prepare(
    `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
     VALUES (1, 'quan_ly_a', ?, 'manager', '2026-08-01T00:00:00Z')`
  ).bind(sharedPasswordHash).run();
  await env.DB.prepare(
    `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
     VALUES (2, 'le_tan_b', ?, 'reception', '2026-08-01T00:00:00Z')`
  ).bind(sharedPasswordHash).run();
  await setOverride(env.DB, 2, 'rooms.layout');
  await env.DB.prepare(
    `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
     VALUES (3, 'le_tan_c', ?, 'reception', '2026-08-01T00:00:00Z')`
  ).bind(sharedPasswordHash).run();
  await setOverride(env.DB, 3, 'finance.create');
});

describe('GET /api/auth/me', () => {
  it('returns 401 when there is no session cookie', async () => {
    const request = new Request('https://crm.hienlegarden.vn/api/auth/me');
    const response = await me({ request, env });
    expect(response.status).toBe(401);
  });

  it('returns the username and role for a valid session', async () => {
    const loginRequest = new Request('https://crm.hienlegarden.vn/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass' }),
    });
    const loginResponse = await login({ request: loginRequest, env });
    const sessionToken = loginResponse.headers.get('Set-Cookie').match(/session=([^;]+)/)[1];

    const request = new Request('https://crm.hienlegarden.vn/api/auth/me', {
      headers: { Cookie: `session=${sessionToken}` },
    });
    const response = await me({ request, env });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: 'quan_ly_a', role: 'manager', totpEnabled: false, permissions: [...ROLE_DEFAULTS.manager].sort() });
  });

  it('includes rooms.layout in permissions for an account with the override set', async () => {
    const loginRequest = new Request('https://crm.hienlegarden.vn/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'le_tan_b', password: 's3cret-pass' }),
    });
    const loginResponse = await login({ request: loginRequest, env });
    const sessionToken = loginResponse.headers.get('Set-Cookie').match(/session=([^;]+)/)[1];

    const request = new Request('https://crm.hienlegarden.vn/api/auth/me', {
      headers: { Cookie: `session=${sessionToken}` },
    });
    const response = await me({ request, env });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ username: 'le_tan_b', role: 'reception', totpEnabled: false, permissions: [...new Set([...ROLE_DEFAULTS.reception, 'rooms.layout'])].sort() });
    expect(body.permissions).toContain('rooms.layout');
  });

  it('includes finance.create in permissions for an account with the override set', async () => {
    const loginRequest = new Request('https://crm.hienlegarden.vn/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'le_tan_c', password: 's3cret-pass' }),
    });
    const loginResponse = await login({ request: loginRequest, env });
    const sessionToken = loginResponse.headers.get('Set-Cookie').match(/session=([^;]+)/)[1];

    const request = new Request('https://crm.hienlegarden.vn/api/auth/me', {
      headers: { Cookie: `session=${sessionToken}` },
    });
    const response = await me({ request, env });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ username: 'le_tan_c', role: 'reception', totpEnabled: false, permissions: [...new Set([...ROLE_DEFAULTS.reception, 'finance.create'])].sort() });
    expect(body.permissions).toContain('finance.create');
  });
});
