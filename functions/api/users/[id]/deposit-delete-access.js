// v4/functions/api/users/[id]/deposit-delete-access.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { canDeleteDeposit } = body || {};

  if (typeof canDeleteDeposit !== 'boolean') {
    return jsonError('Giá trị không hợp lệ', 400);
  }

  const target = await env.DB.prepare(`SELECT id, username, role, can_delete_deposit FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }

  if (canDeleteDeposit && target.role === 'observer') {
    return jsonError('Không thể cấp quyền xoá cọc cho tài khoản người quan sát', 400);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET can_delete_deposit = ? WHERE id = ?`).bind(canDeleteDeposit ? 1 : 0, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_permission_change', 'staff_account', ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, target.username, target.can_delete_deposit ? 'Bật' : 'Tắt', canDeleteDeposit ? 'Bật' : 'Tắt', auth.username, now),
  ]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
