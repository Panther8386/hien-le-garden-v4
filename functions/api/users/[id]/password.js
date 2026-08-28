import { requireAuth } from '../../../../lib/requireAuth.js';
import { hashPassword } from '../../../../lib/auth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  if (String(params.id) === String(auth.staffId)) {
    return jsonError('Không thể tự đặt lại mật khẩu của chính mình bằng chức năng này', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { password } = body || {};

  if (typeof password !== 'string' || password.length < 8) {
    return jsonError('Mật khẩu phải có ít nhất 8 ký tự', 400);
  }

  const target = await env.DB.prepare(`SELECT id, username FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET password_hash = ? WHERE id = ?`).bind(passwordHash, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_password_reset', 'staff_account', ?, ?, NULL, 'Đã đặt lại mật khẩu', ?, ?)`
    ).bind(params.id, target.username, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
