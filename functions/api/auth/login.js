import { verifyPassword, createSession, createPending2FAToken } from '../../../lib/auth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { username, password } = body;

  const account = await env.DB.prepare(
    `SELECT id, password_hash, role, totp_enabled AS totpEnabled FROM staff_accounts WHERE username = ?`
  )
    .bind(username)
    .first();

  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return jsonError('Sai tài khoản hoặc mật khẩu', 401);
  }

  if (account.totpEnabled) {
    const pendingToken = await createPending2FAToken(env.DB, account.id);
    return new Response(JSON.stringify({ requires2fa: true, pendingToken }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = await createSession(env.DB, account.id);

  return new Response(JSON.stringify({ username, role: account.role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
    },
  });
}
