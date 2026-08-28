import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  if (String(auth.staffId) === params.id) {
    return jsonError('Không thể tự xoá tài khoản của chính mình', 400);
  }

  const target = await env.DB.prepare(`SELECT id, username, role FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM staff_accounts WHERE id = ?`).bind(params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_delete', 'staff_account', ?, ?, ?, 'deleted', ?, ?)`
    ).bind(target.id, target.username, target.role, auth.username, now),
  ]);
  return new Response(null, { status: 204 });
}
