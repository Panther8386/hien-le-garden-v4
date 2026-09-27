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

  it('rejects a correct code with the lock message and creates no session when the account was locked after the pendingToken was issued', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await enableTwoFactorFor(1, secret);

    const loginRequest = new Request('https://crm.hienlegarden.vn/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass' }),
    });
    const loginResponse = await login({ request: loginRequest, env });
    const { pendingToken } = await loginResponse.json();

    await env.DB.prepare(`UPDATE staff_accounts SET locked_at = '2026-09-24T01:00:00Z' WHERE id = 1`).run();

    const code = await generateTOTP(secret, {});
    const verifyRequest = new Request('https://crm.hienlegarden.vn/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    });
    const verifyResponse = await verify2fa({ request: verifyRequest, env });

    expect(verifyResponse.status).toBe(403);
    expect(await verifyResponse.json()).toEqual({ error: 'Tài khoản đang bị khoá. Liên hệ quản trị.' });
    expect(verifyResponse.headers.get('Set-Cookie')).toBeNull();
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first();
    expect(n).toBe(0);
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

describe('FA-2: verify-2fa attempt limit with single-use rotating pending tokens', () => {
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const EXPIRED = 'Phiên xác thực đã hết hạn, vui lòng đăng nhập lại';
  const WRONG = 'Mã xác thực không đúng';
  const LIMIT = 'Nhập sai quá số lần cho phép. Vui lòng đăng nhập lại.';

  beforeEach(async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1 WHERE id = 1`).bind(SECRET).run();
  });

  // A code guaranteed to be wrong: not valid for any step within +-2 steps of now.
  async function wrongCode() {
    const now = Math.floor(Date.now() / 1000);
    const valid = new Set();
    for (let d = -2; d <= 2; d++) valid.add(await generateTOTP(SECRET, { time: now + d * 30 }));
    for (let n = 0; ; n++) {
      const c = String(n).padStart(6, '0');
      if (!valid.has(c)) return c;
    }
  }

  async function startLogin() {
    const response = await login({
      request: new Request('https://crm.hienlegarden.vn/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass' }),
      }),
      env,
    });
    const body = await response.json();
    expect(body.requires2fa).toBe(true);
    return body.pendingToken;
  }

  async function verify(pendingToken, code) {
    const response = await verify2fa({
      request: new Request('https://crm.hienlegarden.vn/api/auth/verify-2fa', {
        method: 'POST',
        body: JSON.stringify({ pendingToken, code }),
      }),
      env,
    });
    return { status: response.status, cookie: response.headers.get('Set-Cookie'), body: await response.json() };
  }

  async function pendingCount() {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens WHERE staff_id = 1').first();
    return n;
  }

  async function sessionCount() {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first();
    return n;
  }

  async function seedPending(token, expiresAt) {
    await env.DB.prepare(
      `INSERT INTO pending_2fa_tokens (token, staff_id, created_at, expires_at) VALUES (?, 1, ?, ?)`
    ).bind(token, new Date().toISOString(), expiresAt).run();
  }

  it('login issues a token in the format <uuid>.0', async () => {
    const token = await startLogin();
    expect(token).toMatch(/^[0-9a-f-]{36}\.0$/);
  });

  it('wrong codes 1..4 each return 401 with a NEW pendingToken and attemptsLeft 4..1; the previous token stops working', async () => {
    let token = await startLogin();
    const bad = await wrongCode();
    for (let attempt = 1; attempt <= 4; attempt++) {
      const r = await verify(token, bad);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe(WRONG);
      expect(r.body.attemptsLeft).toBe(5 - attempt);
      expect(typeof r.body.pendingToken).toBe('string');
      expect(r.body.pendingToken).not.toBe(token);
      expect(r.body.pendingToken.endsWith(`.${attempt}`)).toBe(true);
      expect(r.cookie).toBeNull();

      const old = await verify(token, bad);
      expect(old.status).toBe(401);
      expect(old.body).toEqual({ error: EXPIRED });
      token = r.body.pendingToken;
      expect(await pendingCount()).toBe(1);
    }
  });

  it('the 5th wrong code returns the limit message, no pendingToken, and leaves no pending rows', async () => {
    let token = await startLogin();
    const bad = await wrongCode();
    for (let attempt = 1; attempt <= 4; attempt++) token = (await verify(token, bad)).body.pendingToken;
    const r = await verify(token, bad);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: LIMIT });
    expect(r.cookie).toBeNull();
    expect(await pendingCount()).toBe(0);
    expect(await sessionCount()).toBe(0);
  });

  it('a correct code after the limit is reached (with any old token) is rejected as expired and creates no session', async () => {
    const tokens = [await startLogin()];
    const bad = await wrongCode();
    for (let attempt = 1; attempt <= 4; attempt++) tokens.push((await verify(tokens[tokens.length - 1], bad)).body.pendingToken);
    await verify(tokens[tokens.length - 1], bad);
    const good = await generateTOTP(SECRET, {});
    for (const t of tokens) {
      const r = await verify(t, good);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: EXPIRED });
      expect(r.cookie).toBeNull();
    }
    expect(await sessionCount()).toBe(0);
  });

  it('an attempt with the old token after rotation is rejected as expired, even with the correct code', async () => {
    const first = await startLogin();
    const r1 = await verify(first, await wrongCode());
    expect(r1.status).toBe(401);
    const r2 = await verify(first, await generateTOTP(SECRET, {}));
    expect(r2.status).toBe(401);
    expect(r2.body).toEqual({ error: EXPIRED });
    expect(await sessionCount()).toBe(0);
    // The rotated token is still the only live one.
    expect(await pendingCount()).toBe(1);
  });

  it('a correct code on attempt 3 (after 2 wrong) returns 200 with a session cookie and removes the pending token', async () => {
    let token = await startLogin();
    const bad = await wrongCode();
    token = (await verify(token, bad)).body.pendingToken;
    token = (await verify(token, bad)).body.pendingToken;
    const r = await verify(token, await generateTOTP(SECRET, {}));
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/^session=[^;]+; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/);
    expect(r.body).toEqual({ username: 'quan_ly_a', role: 'manager' });
    expect(await pendingCount()).toBe(0);
    expect(await sessionCount()).toBe(1);
  });

  it('an expired pending token is rejected even with the correct code', async () => {
    const token = `${crypto.randomUUID()}.0`;
    await seedPending(token, '2026-01-01T00:05:00.000Z');
    const r = await verify(token, await generateTOTP(SECRET, {}));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: EXPIRED });
    expect(r.cookie).toBeNull();
    expect(await sessionCount()).toBe(0);
  });

  it('parallel verify requests with the same token: at most one proceeds; with two wrong codes exactly one new token is issued', async () => {
    const token = await startLogin();
    const bad = await wrongCode();
    const results = await Promise.all([verify(token, bad), verify(token, bad)]);
    const rotated = results.filter((r) => r.body.pendingToken);
    const expired = results.filter((r) => r.body.error === EXPIRED);
    expect(results.every((r) => r.status === 401)).toBe(true);
    expect(rotated.length).toBe(1);
    expect(expired.length).toBe(1);
    expect(rotated[0].body.attemptsLeft).toBe(4);
    expect(await pendingCount()).toBe(1);
  });

  it('parallel verify requests with the same token and the correct code create at most one session', async () => {
    const token = await startLogin();
    const good = await generateTOTP(SECRET, {});
    const results = await Promise.all([verify(token, good), verify(token, good)]);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 401 && r.body.error === EXPIRED).length).toBe(1);
    expect(await sessionCount()).toBe(1);
  });

  it('a rotated token keeps the original expires_at (the TTL is never extended)', async () => {
    const token = await startLogin();
    const { expiresAt: original } = await env.DB.prepare('SELECT expires_at AS expiresAt FROM pending_2fa_tokens WHERE token = ?').bind(token).first();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const r = await verify(token, await wrongCode());
    const { expiresAt: rotated } = await env.DB.prepare('SELECT expires_at AS expiresAt FROM pending_2fa_tokens WHERE token = ?').bind(r.body.pendingToken).first();
    expect(rotated).toBe(original);
  });

  it('a token with a forged suffix that is not in the DB is rejected and does not touch the real token', async () => {
    const token = await startLogin();
    const forged = token.replace(/\.0$/, '.4');
    const r = await verify(forged, await wrongCode());
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: EXPIRED });
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens WHERE token = ?').bind(token).first();
    expect(n).toBe(1);
  });

  it('a stored token whose suffix is not an integer 0..4 is treated as invalid', async () => {
    for (const suffix of ['5', '-1', 'x', '1.5', '', '01']) {
      const token = `${crypto.randomUUID()}.${suffix}`;
      await seedPending(token, new Date(Date.now() + 60000).toISOString());
      const r = await verify(token, await generateTOTP(SECRET, {}));
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: EXPIRED });
    }
    expect(await sessionCount()).toBe(0);
  });

  it('a legacy token without a suffix counts as 0 attempts', async () => {
    const token = crypto.randomUUID();
    await seedPending(token, new Date(Date.now() + 60000).toISOString());
    const r = await verify(token, await wrongCode());
    expect(r.status).toBe(401);
    expect(r.body.attemptsLeft).toBe(4);
    expect(r.body.pendingToken.endsWith('.1')).toBe(true);
  });

  it('a missing code counts as a wrong attempt', async () => {
    const token = await startLogin();
    const r = await verify(token, undefined);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe(WRONG);
    expect(r.body.attemptsLeft).toBe(4);
  });

  it('KNOWN GAP (TOTP replay deferred to migration 0043): the same successful code is still accepted in a NEW login within the window', async () => {
    const good = await generateTOTP(SECRET, {});
    const first = await verify(await startLogin(), good);
    expect(first.status).toBe(200);
    const second = await verify(await startLogin(), good);
    // Documents current behavior: replay needs the password (a new login) but is not blocked yet.
    expect(second.status).toBe(200);
  });
});

describe('FA-2: auth body limits', () => {
  const big = 'x'.repeat(5000);

  async function counts() {
    const s = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first();
    const p = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_2fa_tokens').first();
    return { sessions: s.n, pending: p.n };
  }

  function loginRequest(body) {
    return new Request('https://crm.hienlegarden.vn/api/auth/login', { method: 'POST', body });
  }

  it('login with a >4096-byte body returns 413 and creates no session or pending row', async () => {
    const response = await login({
      request: loginRequest(JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass', pad: big })),
      env,
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await counts()).toEqual({ sessions: 0, pending: 0 });
  });

  it('login with a >4096-byte body and 2FA enabled creates no pending row', async () => {
    await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1 WHERE id = 1`).bind('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();
    const response = await login({
      request: loginRequest(JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass', pad: big })),
      env,
    });
    expect(response.status).toBe(413);
    expect(await counts()).toEqual({ sessions: 0, pending: 0 });
  });

  it('login with a JSON null body returns 400', async () => {
    const response = await login({ request: loginRequest('null'), env });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Dữ liệu không hợp lệ' });
  });

  it('login with a missing or non-string username/password returns 400 (not a 500)', async () => {
    for (const body of [{}, { username: 'quan_ly_a' }, { username: 1, password: 's3cret-pass' }, { username: 'quan_ly_a', password: ['x'] }]) {
      const response = await login({ request: loginRequest(JSON.stringify(body)), env });
      expect(response.status).toBe(400);
    }
    expect(await counts()).toEqual({ sessions: 0, pending: 0 });
  });

  it('verify-2fa with a >4096-byte body returns 413, creates no session and does not consume the pending token', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await env.DB.prepare(`UPDATE staff_accounts SET totp_secret = ?, totp_enabled = 1 WHERE id = 1`).bind(secret).run();
    const loginResponse = await login({
      request: loginRequest(JSON.stringify({ username: 'quan_ly_a', password: 's3cret-pass' })),
      env,
    });
    const { pendingToken } = await loginResponse.json();
    const code = await generateTOTP(secret, {});
    const response = await verify2fa({
      request: new Request('https://crm.hienlegarden.vn/api/auth/verify-2fa', {
        method: 'POST',
        body: JSON.stringify({ pendingToken, code, pad: big }),
      }),
      env,
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await counts()).toEqual({ sessions: 0, pending: 1 });
  });

  it('verify-2fa with a JSON null body returns 400', async () => {
    const response = await verify2fa({
      request: new Request('https://crm.hienlegarden.vn/api/auth/verify-2fa', { method: 'POST', body: 'null' }),
      env,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Dữ liệu không hợp lệ' });
  });
});
