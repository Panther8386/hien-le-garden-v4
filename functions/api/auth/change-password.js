import { requireAuth } from '../../../lib/requireAuth.js';
import { hashPassword, verifyPassword } from '../../../lib/auth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { currentPassword, newPassword } = body;

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return jsonError('Mật khẩu mới phải có ít nhất 8 ký tự', 400);
  }

  const account = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = ?`).bind(auth.staffId).first();
  if (!account || typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, account.passwordHash))) {
    return jsonError('Mật khẩu hiện tại không đúng', 400);
  }

  const newHash = await hashPassword(newPassword);
  await env.DB.prepare(`UPDATE staff_accounts SET password_hash = ? WHERE id = ?`).bind(newHash, auth.staffId).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
