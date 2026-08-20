import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as changePassword } from '../functions/api/auth/change-password.js';
import { createSession, hashPassword, verifyPassword } from '../lib/auth.js';

let sharedHash, token;

beforeAll(async () => {
  sharedHash = await hashPassword('MatKhauCu123');
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'le_tan_a', ?, 'reception', '2026-08-01T00:00:00Z')`).bind(sharedHash).run();
  token = await createSession(env.DB, 1);
});

function authedRequest(body) {
  return new Request('https://x/api/auth/change-password', { method: 'POST', headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/auth/change-password', () => {
  it('rejects unauthenticated requests', async () => {
    const request = new Request('https://x/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'a', newPassword: 'MatKhauMoi123' }) });
    const response = await changePassword({ request, env });
    expect(response.status).toBe(401);
  });

  it('changes the password when currentPassword is correct', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'MatKhauCu123', newPassword: 'MatKhauMoi123' }), env });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = 1`).first();
    expect(await verifyPassword('MatKhauMoi123', row.passwordHash)).toBe(true);
  });

  it('rejects when currentPassword is wrong (400)', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'sai-mat-khau', newPassword: 'MatKhauMoi123' }), env });
    expect(response.status).toBe(400);

    const row = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = 1`).first();
    expect(await verifyPassword('MatKhauCu123', row.passwordHash)).toBe(true);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const response = await changePassword({ request: authedRequest({ currentPassword: 'MatKhauCu123', newPassword: '123' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new Request('https://x/api/auth/change-password', { method: 'POST', headers: { Cookie: `session=${token}` }, body: 'not json' });
    const response = await changePassword({ request, env });
    expect(response.status).toBe(400);
  });
});
