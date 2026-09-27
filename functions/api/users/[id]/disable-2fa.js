import { requireAuth } from '../../../../lib/requireAuth.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { guardTarget } from '../../../../lib/staffGuards.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.security');
  if (auth instanceof Response) return auth;
  // Viewing accounts requires users.manage: without it answer like a missing account.
  if (!hasPermission(auth, 'users.manage')) return jsonError('Không tìm thấy tài khoản', 404);

  const target = await env.DB.prepare(
    `SELECT id, username, role, totp_enabled AS totpEnabled FROM staff_accounts WHERE id = ?`
  )
    .bind(params.id)
    .first();
  const denied = guardTarget(auth, target, { allowSelf: true });
  if (denied) return denied;
  if (!target.totpEnabled) {
    return jsonError('Tài khoản này chưa bật 2FA', 400);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?`).bind(params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('2fa_admin_disable', 'staff_account', ?, ?, 'Đã bật', 'Đã tắt (quản trị viên tắt giúp)', ?, ?)`
    ).bind(target.id, target.username, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
