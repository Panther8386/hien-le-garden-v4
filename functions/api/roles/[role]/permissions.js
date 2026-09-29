import { requireAuth } from '../../../../lib/requireAuth.js';
import { EDITABLE_ROLES, isValidPermission } from '../../../../lib/permissions.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'admin') return jsonError('Không đủ quyền', 403);

  if (params.role === 'admin') return jsonError('Không thể sửa quyền của vai trò quản trị', 400);
  if (!EDITABLE_ROLES.includes(params.role)) return jsonError('Vai trò không hợp lệ', 400);

  let body;
  try { body = await request.json(); } catch { return jsonError('Dữ liệu không hợp lệ', 400); }
  if (!body || !Array.isArray(body.permissions)) return jsonError('Dữ liệu không hợp lệ', 400);
  const next = [...new Set(body.permissions)].sort();
  const bad = next.find((p) => !isValidPermission(p));
  if (bad) return jsonError(`Mã quyền không hợp lệ: ${bad}`, 400);

  const { results } = await env.DB.prepare('SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission').bind(params.role).all();
  const prev = results.map((r) => r.permission);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM role_permissions WHERE role = ?').bind(params.role),
    ...next.map((p) => env.DB.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)').bind(params.role, p)),
    // audit_log.entity_id là NOT NULL; vai trò không có id nên ghi 0, tên vai trò nằm ở entity_label.
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('role_permissions_change', 'role', 0, ?, ?, ?, ?, ?)`
    ).bind(params.role, prev.join(','), next.join(','), auth.username, new Date().toISOString()),
  ]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
