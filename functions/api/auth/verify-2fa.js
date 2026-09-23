import { createSession, getPendingStaffId, deletePendingToken } from '../../../lib/auth.js';
import { verifyTOTP } from '../../../lib/totp.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { pendingToken, code } = body;

  const staffId = typeof pendingToken === 'string' ? await getPendingStaffId(env.DB, pendingToken) : null;
  if (!staffId) {
    return jsonError('Phiên xác thực đã hết hạn, vui lòng đăng nhập lại', 401);
  }

  const account = await env.DB.prepare(
    `SELECT id, username, role, totp_secret AS totpSecret FROM staff_accounts WHERE id = ?`
  )
    .bind(staffId)
    .first();

  if (!account || !account.totpSecret || typeof code !== 'string' || !(await verifyTOTP(account.totpSecret, code))) {
    return jsonError('Mã xác thực không đúng', 401);
  }

  await deletePendingToken(env.DB, pendingToken);
  const token = await createSession(env.DB, account.id);

  return new Response(JSON.stringify({ username: account.username, role: account.role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
    },
  });
}
