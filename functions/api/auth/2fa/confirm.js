import { requireAuth } from '../../../../lib/requireAuth.js';
import { verifyTOTP } from '../../../../lib/totp.js';

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
  const { code } = body;

  const account = await env.DB.prepare(`SELECT totp_secret AS totpSecret FROM staff_accounts WHERE id = ?`).bind(auth.staffId).first();
  if (!account || !account.totpSecret) {
    return jsonError('Chưa thiết lập Google Authenticator', 400);
  }

  if (typeof code !== 'string' || !(await verifyTOTP(account.totpSecret, code))) {
    return jsonError('Mã xác thực không đúng', 400);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET totp_enabled = 1 WHERE id = ?`).bind(auth.staffId),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('2fa_enable', 'staff_account', ?, ?, NULL, 'Đã bật', ?, ?)`
    ).bind(auth.staffId, auth.username, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
