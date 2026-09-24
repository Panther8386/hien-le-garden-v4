import { requireAuth } from '../../../lib/requireAuth.js';
import { loadTarget, guardTarget, isLastActiveAdmin } from '../../../lib/staffGuards.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;

  if (String(auth.staffId) === String(params.id)) {
    return jsonError('Không thể tự xoá tài khoản của chính mình', 400);
  }

  const target = await loadTarget(env.DB, params.id);
  const denied = guardTarget(auth, target);
  if (denied) return denied;
  if (await isLastActiveAdmin(env.DB, target.id)) {
    return jsonError('Không thể xoá quản trị cuối cùng', 400);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM user_permission_overrides WHERE staff_id = ?`).bind(target.id),
    env.DB.prepare(`DELETE FROM staff_accounts WHERE id = ?`).bind(target.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_delete', 'staff_account', ?, ?, ?, 'deleted', ?, ?)`
    ).bind(target.id, target.username, target.role, auth.username, now),
  ]);
  return new Response(null, { status: 204 });
}
