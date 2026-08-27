import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listUsers, onRequestPost as createUser } from '../functions/api/users/index.js';
import { createSession, verifyPassword } from '../lib/auth.js';

let managerToken, receptionToken, adminToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'admin_a', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  receptionToken = await createSession(env.DB, 2);
  adminToken = await createSession(env.DB, 3);
});

function authedRequest(url, token, method, body) {
  return new Request(url, { method, headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/users', () => {
  it('lets a manager list users without exposing password hashes', async () => {
    const response = await listUsers({ request: authedRequest('https://x/api/users', managerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(3);
    expect(body[0]).not.toHaveProperty('passwordHash');
    expect(body[0]).not.toHaveProperty('password_hash');
  });

  it('rejects a reception account (403)', async () => {
    const response = await listUsers({ request: authedRequest('https://x/api/users', receptionToken, 'GET'), env });
    expect(response.status).toBe(403);
  });
});

describe('POST /api/users', () => {
  it('lets a manager create a new account with a hashed password', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'le_tan_b', password: 'MatKhauManh123', role: 'reception' }), env });
    expect(response.status).toBe(201);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash, role FROM staff_accounts WHERE username = 'le_tan_b'`).first();
    expect(row.role).toBe('reception');
    expect(row.passwordHash).not.toBe('MatKhauManh123');
    expect(await verifyPassword('MatKhauManh123', row.passwordHash)).toBe(true);
  });

  it('lets an admin create a reception account', async () => {
    const request = authedRequest('https://x/api/users', adminToken, 'POST', {
      username: 'new_reception', password: 'password123', role: 'reception',
    });
    const response = await createUser({ request, env });
    expect(response.status).toBe(201);
  });

  it('lets an admin create another admin account', async () => {
    const request = authedRequest('https://x/api/users', adminToken, 'POST', {
      username: 'second_admin', password: 'password123', role: 'admin',
    });
    const response = await createUser({ request, env });
    expect(response.status).toBe(201);
  });

  it('lets a manager create an observer account', async () => {
    const request = authedRequest('https://x/api/users', managerToken, 'POST', {
      username: 'obs_a', password: 'password123', role: 'observer',
    });
    const response = await createUser({ request, env });
    expect(response.status).toBe(201);
  });

  it('rejects a duplicate username (409)', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'quan_ly_a', password: 'x12345678', role: 'reception' }), env });
    expect(response.status).toBe(409);
  });

  it('rejects an invalid role', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'x', password: 'x12345678', role: 'superadmin' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a short password', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', managerToken, 'POST', { username: 'x', password: '123', role: 'reception' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a reception account (403)', async () => {
    const response = await createUser({ request: authedRequest('https://x/api/users', receptionToken, 'POST', { username: 'x', password: 'x12345678', role: 'reception' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/users', { method: 'POST', headers: { Cookie: `session=${managerToken}` }, body: 'not json' });
    const response = await createUser({ request, env });
    expect(response.status).toBe(400);
  });
});
