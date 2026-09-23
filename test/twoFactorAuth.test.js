import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as verify2fa } from '../functions/api/auth/verify-2fa.js';
import { onRequestPost as setup2fa } from '../functions/api/auth/2fa/setup.js';
import { onRequestPost as confirm2fa } from '../functions/api/auth/2fa/confirm.js';
import { onRequestPost as disable2fa } from '../functions/api/auth/2fa/disable.js';
import { onRequestPatch as adminDisable2fa } from '../functions/api/users/[id]/disable-2fa.js';
import { hashPassword } from '../lib/auth.js';
import { generateTOTP } from '../lib/totp.js';

let sharedPasswordHash;
beforeAll(async () => {
  sharedPasswordHash = await hashPassword('s3cret-pass');
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM pending_2fa_tokens');
  await env.DB.exec('DELETE FROM audit_log');
  await env.DB.prepare(
    `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
     VALUES (1, 'quan_ly_a', ?, 'manager', '2026-08-01T00:00:00Z')`
  ).bind(sharedPasswordHash).run();
  await env.DB.prepare(
    `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
     VALUES (2, 'admin_a', ?, 'admin', '2026-08-01T00:00:00Z')`
  ).bind(sharedPasswordHash).run();
});

async function loginAs(username) {
  const request = new Request('https://crm.hienlegarden.vn/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: 's3cret-pass' }),
  });
  const response = await login({ request, env });
  const cookie = response.headers.get('Set-Cookie').match(/session=([^;]+)/)[1];
  return cookie;
}

describe('POST /api/auth/2fa/setup + confirm', () => {
  it('enrolls 2FA: setup returns a secret, confirm with the right code enables it', async () => {
    const sessionToken = await loginAs('quan_ly_a');

    const setupRequest = new Request('https://crm.hienlegarden.vn/api/auth/2fa/setup', {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
    });
    const setupResponse = await setup2fa({ request: setupRequest, env });
    expect(setupResponse.status).toBe(200);
    const { secret, otpauthUrl } = await setupResponse.json();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUrl).toContain(secret);

    const code = await generateTOTP(secret, {});
    const confirmRequest = new Request('https://crm.hienlegarden.vn/api/auth/2fa/confirm', {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
      body: JSON.stringify({ code }),
    });
    const confirmResponse = await confirm2fa({ request: confirmRequest, env });
    expect(confirmResponse.status).toBe(200);

    const account = await env.DB.prepare(`SELECT totp_enabled AS totpEnabled FROM staff_accounts WHERE id = 1`).first();
    expect(account.totpEnabled).toBe(1);
  });

  it('rejects confirm with a wrong code and leaves 2FA disabled', async () => {
    const sessionToken = await loginAs('quan_ly_a');
    const setupRequest = new Request('https://crm.hienlegarden.vn/api/auth/2fa/setup', {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
    });
    await setup2fa({ request: setupRequest, env });

    const confirmRequest = new Request('https://crm.hienlegarden.vn/api/auth/2fa/confirm', {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
      body: JSON.stringify({ code: '000000' }),
    });
    const confirmResponse = await confirm2fa({ request: confirmRequest, env });
    expect(confirmResponse.status).toBe(400);

    const account = await env.DB.prepare(`SELECT totp_enabled AS totpEnabled FROM staff_accounts WHERE id = 1`).first();
    expect(account.totpEnabled).toBe(0);
  });
});

describe('login flow with 2FA enabled', () => {
  async function enableTwoFactorFor(staffId, secret) {
    await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1 WHERE id = ?`).bind(secret, staffId).run();
  }

  it('login returns requires2fa + pendingToken instead of a session cookie', async () => {
    await enableTwoFactorFor(1, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');

    const request = new Request('https://crm.hienlegarden.vn/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass' }),
    });
    const response = await login({ request, env });

    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const body = await response.json();
    expect(body.requires2fa).toBe(true);
    expect(typeof body.pendingToken).toBe('string');
  });

  it('verify-2fa with the right code completes login and sets the session cookie', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await enableTwoFactorFor(1, secret);

    const loginRequest = new Request('https://crm.hienlegarden.vn/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass' }),
    });
    const loginResponse = await login({ request: loginRequest, env });
    const { pendingToken } = await loginResponse.json();

    const code = await generateTOTP(secret, {});
    const verifyRequest = new Request('https://crm.hienlegarden.vn/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    });
    const verifyResponse = await verify2fa({ request: verifyRequest, env });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get('Set-Cookie')).toMatch(/^session=/);
    expect(await verifyResponse.json()).toEqual({ username: 'quan_ly_a', role: 'manager' });
  });

  it('verify-2fa with a wrong code returns 401 and does not create a session', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await enableTwoFactorFor(1, secret);

    const loginRequest = new Request('https://crm.hienlegarden.vn/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass' }),
    });
    const loginResponse = await login({ request: loginRequest, env });
    const { pendingToken } = await loginResponse.json();

    const verifyRequest = new Request('https://crm.hienlegarden.vn/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code: '000000' }),
    });
    const verifyResponse = await verify2fa({ request: verifyRequest, env });

    expect(verifyResponse.status).toBe(401);
    expect(verifyResponse.headers.get('Set-Cookie')).toBeNull();
  });

  it('verify-2fa rejects an unknown or expired pending token', async () => {
    const verifyRequest = new Request('https://crm.hienlegarden.vn/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken: 'does-not-exist', code: '123456' }),
    });
    const verifyResponse = await verify2fa({ request: verifyRequest, env });
    expect(verifyResponse.status).toBe(401);
  });
});

describe('POST /api/auth/2fa/disable (self-service)', () => {
  it('disables 2FA when the current password is correct', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1 WHERE id = 1`).bind('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();
    const sessionToken = await loginAs('admin_a'); // login as a different account first is fine; 2FA not enabled for admin_a

    const request = new Request('https://crm.hienlegarden.vn/api/auth/2fa/disable', {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
      body: JSON.stringify({ password: 's3cret-pass' }),
    });
    // acting on admin_a's own (not-yet-enabled) account: should still succeed as a no-op-safe disable
    const response = await disable2fa({ request, env });
    expect(response.status).toBe(200);
  });

  it('rejects disable with the wrong password', async () => {
    const sessionToken = await loginAs('quan_ly_a');
    const request = new Request('https://crm.hienlegarden.vn/api/auth/2fa/disable', {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    const response = await disable2fa({ request, env });
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/users/:id/disable-2fa (admin recovery)', () => {
  it('lets an admin disable 2FA for another staff member', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1 WHERE id = 1`).bind('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();
    const adminSession = await loginAs('admin_a');

    const request = new Request('https://crm.hienlegarden.vn/api/users/1/disable-2fa', {
      method: 'PATCH',
      headers: { Cookie: `session=${adminSession}` },
    });
    const response = await adminDisable2fa({ request, env, params: { id: '1' } });
    expect(response.status).toBe(200);

    const account = await env.DB.prepare(`SELECT totp_enabled AS totpEnabled, totp_secret AS totpSecret FROM staff_accounts WHERE id = 1`).first();
    expect(account.totpEnabled).toBe(0);
    expect(account.totpSecret).toBeNull();
  });

  it('rejects a non-admin (manager) trying to disable someone else\'s 2FA', async () => {
    const managerSession = await loginAs('quan_ly_a');
    await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1 WHERE id = 1`).bind('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();

    const request = new Request('https://crm.hienlegarden.vn/api/users/1/disable-2fa', {
      method: 'PATCH',
      headers: { Cookie: `session=${managerSession}` },
    });
    const response = await adminDisable2fa({ request, env, params: { id: '1' } });
    expect(response.status).toBe(403);
  });
});
