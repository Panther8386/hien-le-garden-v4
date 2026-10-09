import { createSession, consumePendingToken, createPending2FAToken, MAX_2FA_ATTEMPTS } from '../../../lib/auth.js';
import { verifyTOTP } from '../../../lib/totp.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';

const MAX_BODY_BYTES = 4096;

function json(payload, status) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function jsonError(message, status) {
  return json({ error: message }, status);
}

export async function onRequestPost({ request, env }) {
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const { pendingToken, code } = parsed.body;

  // Tiêu thụ token trước mọi việc khác (single-use): request song song cùng
  // token chỉ một request đi tiếp, các request còn lại nhận 401 hết hạn.
  const pending = await consumePendingToken(env.DB, pendingToken);
  if (!pending) {
    return jsonError('Phiên xác thực đã hết hạn, vui lòng đăng nhập lại', 401);
  }

  const account = await env.DB.prepare(
    `SELECT id, username, role, totp_secret AS totpSecret, locked_at AS lockedAt FROM staff_accounts WHERE id = ?`
  )
    .bind(pending.staffId)
    .first();

  if (!account || !pending.passwordHash) {
    return jsonError('Phiên xác thực đã hết hạn, vui lòng đăng nhập lại', 401);
  }

  if (!account.totpSecret || typeof code !== 'string' || !(await verifyTOTP(account.totpSecret, code))) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_2FA_ATTEMPTS) {
      return jsonError('Nhập sai quá số lần cho phép. Vui lòng đăng nhập lại.', 401);
    }
    // Cấp token mới cho lần thử tiếp theo, GIỮ NGUYÊN hạn cũ (không kéo dài TTL).
    const nextToken = await createPending2FAToken(env.DB, account.id, { attempts, expiresAt: pending.expiresAt, passwordHash: pending.passwordHash });
    if (!nextToken) return jsonError('Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 401);
    return json({ error: 'Mã xác thực không đúng', pendingToken: nextToken, attemptsLeft: MAX_2FA_ATTEMPTS - attempts }, 401);
  }

  if (account.lockedAt) {
    return jsonError('Tài khoản đang bị khoá. Liên hệ quản trị.', 403);
  }

  const token = await createSession(env.DB, account.id, { passwordHash: pending.passwordHash });
  if (!token) return jsonError('Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 401);

  return new Response(JSON.stringify({ username: account.username, role: account.role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
    },
  });
}
