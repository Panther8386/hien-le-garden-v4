import { requireAuth } from '../../../lib/requireAuth.js';
import { hashPassword, verifyPassword } from '../../../lib/auth.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';
import { consumePasswordChangeBudget } from '../../../lib/loginRateLimit.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;

  const parsed = await readJsonBody(request, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const { currentPassword, newPassword } = parsed.body;

  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 256 || typeof currentPassword !== 'string' || currentPassword.length > 256) {
    return jsonError('Mật khẩu mới phải có 8–256 ký tự; mật khẩu hiện tại tối đa 256 ký tự', 400);
  }

  let budget;
  try { budget = await consumePasswordChangeBudget(env.DB, request, auth.staffId); }
  catch { return throttle(503, 60); }
  if (!budget.allowed) return throttle(429, budget.retryAfter);

  const account = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = ?`).bind(auth.staffId).first();
  if (!account || typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, account.passwordHash))) {
    return jsonError('Mật khẩu hiện tại không đúng', 400);
  }

  const newHash = await hashPassword(newPassword), now = new Date().toISOString();
  const sessionToken = (request.headers.get('Cookie') || '').match(/(?:^|; )session=([^;]+)/)?.[1];
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(`UPDATE staff_accounts SET password_hash = ? WHERE id = ? AND password_hash = ? AND locked_at IS NULL
        AND EXISTS (SELECT 1 FROM sessions WHERE token = ? AND staff_id = ? AND expires_at > ?) RETURNING id`)
        .bind(newHash, auth.staffId, account.passwordHash, sessionToken, auth.staffId, now),
      // Fresh random-salt hash is an unguessable transaction gate. A losing
      // concurrent request cannot revoke sessions or append a success audit.
      env.DB.prepare(`DELETE FROM sessions WHERE staff_id = ? AND EXISTS (SELECT 1 FROM staff_accounts WHERE id = ? AND password_hash = ?)`)
        .bind(auth.staffId, auth.staffId, newHash),
      env.DB.prepare(`DELETE FROM pending_2fa_tokens WHERE staff_id = ? AND EXISTS (SELECT 1 FROM staff_accounts WHERE id = ? AND password_hash = ?)`)
        .bind(auth.staffId, auth.staffId, newHash),
      env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
        SELECT 'account_password_change', 'staff_account', id, username, NULL, 'Đã đổi mật khẩu và thu hồi mọi phiên', ?, ?
        FROM staff_accounts WHERE id = ? AND password_hash = ?`).bind(auth.username, now, auth.staffId, newHash),
    ]);
  } catch { return jsonError('Không thể đổi mật khẩu lúc này. Vui lòng thử lại.', 503); }
  if (!results[0].results?.length) return jsonError('Phiên hoặc mật khẩu đã thay đổi. Vui lòng đăng nhập lại.', 409);

  return new Response(JSON.stringify({ ok: true, requiresLogin: true }), { status: 200, headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
  } });
}

function throttle(status, seconds) {
  return new Response(JSON.stringify({ retryAfter: seconds, error: status === 429
    ? `Bạn đã thử đổi mật khẩu quá nhiều lần. Vui lòng thử lại sau ${seconds} giây.`
    : 'Đổi mật khẩu tạm thời không khả dụng. Vui lòng thử lại sau.' }), {
    status, headers: { 'Content-Type': 'application/json', 'Retry-After': String(seconds), 'Cache-Control': 'no-store' },
  });
}
