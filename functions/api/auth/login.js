import { verifyPassword, createSession, createPending2FAToken } from '../../../lib/auth.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';
import { consumeLoginBudget, loginThrottleResponse } from '../../../lib/loginRateLimit.js';

const MAX_BODY_BYTES = 4096;

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const { username, password } = parsed.body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  try {
    const budget = await consumeLoginBudget(env.DB, request, username);
    if (!budget.allowed) return loginThrottleResponse(429, budget.retryAfter);
  } catch {
    // A missing migration or DB error must not silently disable protection.
    return loginThrottleResponse(503, 60);
  }

  const account = await env.DB.prepare(
    `SELECT id, password_hash, role, totp_enabled AS totpEnabled, locked_at AS lockedAt FROM staff_accounts WHERE username = ?`
  )
    .bind(username)
    .first();

  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return jsonError('Sai tài khoản hoặc mật khẩu', 401);
  }

  if (account.lockedAt) {
    return jsonError('Tài khoản đang bị khoá. Liên hệ quản trị.', 403);
  }

  if (account.totpEnabled) {
    const pendingToken = await createPending2FAToken(env.DB, account.id, { passwordHash: account.password_hash });
    if (!pendingToken) return jsonError('Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 401);
    return new Response(JSON.stringify({ requires2fa: true, pendingToken }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = await createSession(env.DB, account.id, { passwordHash: account.password_hash });
  if (!token) return jsonError('Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 401);

  return new Response(JSON.stringify({ username, role: account.role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
    },
  });
}
