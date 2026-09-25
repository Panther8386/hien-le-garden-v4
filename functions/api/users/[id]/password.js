import { requireAuth } from '../../../../lib/requireAuth.js';
import { hashPassword } from '../../../../lib/auth.js';
import { guardTarget } from '../../../../lib/staffGuards.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.security');
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

  const target = await env.DB.prepare(`SELECT id, username, role FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  const denied = guardTarget(auth, target, { allowSelf: true });
  if (denied) return denied;

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET password_hash = ? WHERE id = ?`).bind(passwordHash, params.id),
    // A reset means the old credential is no longer trusted: sign the target out
    // everywhere and drop any half-finished 2FA login started with the old password.
    env.DB.prepare(`DELETE FROM sessions WHERE staff_id = ?`).bind(params.id),
    env.DB.prepare(`DELETE FROM pending_2fa_tokens WHERE staff_id = ?`).bind(params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_password_reset', 'staff_account', ?, ?, NULL, 'Đã đặt lại mật khẩu', ?, ?)`
    ).bind(params.id, target.username, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
