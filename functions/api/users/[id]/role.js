import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { role } = body;
  if (!['manager', 'reception', 'admin', 'observer'].includes(role)) {
    return jsonError('Vai trò phải là manager, reception, admin hoặc observer', 400);
  }

  const target = await env.DB.prepare(`SELECT username, role FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }

  if (target.role === 'manager' && role === 'reception') {
    const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'manager'`).first();
    if (n <= 1) {
      return jsonError('Không thể hạ quyền manager cuối cùng', 400);
    }
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE staff_accounts SET role = ? WHERE id = ?`).bind(role, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('account_role_change', 'staff_account', ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, target.username, target.role, role, auth.username, now),
  ]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
