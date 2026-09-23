import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const target = await env.DB.prepare(
    `SELECT id, username, totp_enabled AS totpEnabled FROM staff_accounts WHERE id = ?`
  )
    .bind(params.id)
    .first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }
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
