import { requireAuth } from '../../../../lib/requireAuth.js';
import { loadTarget, guardTarget, isLastActiveAdmin, missingRolePermissions } from '../../../../lib/staffGuards.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;

  const target = await loadTarget(env.DB, params.id);
  const denied = guardTarget(auth, target);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { role } = body || {};
  if (!['manager', 'reception', 'admin', 'observer'].includes(role)) {
    return jsonError('Vai trò phải là manager, reception, admin hoặc observer', 400);
  }
  if (role === 'admin' && auth.role !== 'admin') {
    return jsonError('Chỉ quản trị mới được gán vai trò quản trị', 403);
  }
  if (role === target.role) {
    // Không đổi gì: giữ override, không ghi nhật ký.
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if ((await missingRolePermissions(env.DB, auth, role)).length > 0) {
    return jsonError('Không thể gán vai trò có quyền mà bạn không có', 403);
  }
  if (target.role === 'admin' && role !== 'admin' && await isLastActiveAdmin(env.DB, target.id)) {
    return jsonError('Không thể hạ quyền quản trị cuối cùng', 400);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET role = ? WHERE id = ?`).bind(role, target.id),
    // Quyền chỉnh riêng được cấp theo vai trò cũ, không giữ lại khi đổi vai trò (spec mục 7, quy tắc 5).
    env.DB.prepare(`DELETE FROM user_permission_overrides WHERE staff_id = ?`).bind(target.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_role_change', 'staff_account', ?, ?, ?, ?, ?, ?)`
    ).bind(target.id, target.username, target.role, role, auth.username, now),
  ]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
