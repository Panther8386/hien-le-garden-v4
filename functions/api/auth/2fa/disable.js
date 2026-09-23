import { requireAuth } from '../../../../lib/requireAuth.js';
import { verifyPassword } from '../../../../lib/auth.js';

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
  const { password } = body;

  const account = await env.DB.prepare(`SELECT password_hash AS passwordHash FROM staff_accounts WHERE id = ?`).bind(auth.staffId).first();
  if (!account || typeof password !== 'string' || !(await verifyPassword(password, account.passwordHash))) {
    return jsonError('Mật khẩu không đúng', 400);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?`).bind(auth.staffId),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('2fa_disable', 'staff_account', ?, ?, 'Đã bật', 'Đã tắt', ?, ?)`
    ).bind(auth.staffId, auth.username, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
