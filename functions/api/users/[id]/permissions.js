import { requireAuth } from '../../../../lib/requireAuth.js';
import { isValidPermission, hasPermission, effectivePermissions } from '../../../../lib/permissions.js';
import { loadTarget, guardTarget } from '../../../../lib/staffGuards.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const jsonError = (message, status) => json({ error: message }, status);

async function readOverrides(db, staffId) {
  const { results } = await db.prepare('SELECT permission, effect FROM user_permission_overrides WHERE staff_id = ? ORDER BY permission').bind(staffId).all();
  return results;
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;
  const target = await loadTarget(env.DB, params.id);
  if (!target) return jsonError('Không tìm thấy tài khoản', 404);

  const overrides = await readOverrides(env.DB, target.id);
  const { results } = await env.DB.prepare('SELECT permission FROM role_permissions WHERE role = ?').bind(target.role).all();
  const effective = [...effectivePermissions(target.role, results.map((r) => r.permission), overrides)].sort();
  return json({ role: target.role, overrides: Object.fromEntries(overrides.map((o) => [o.permission, o.effect])), effective });
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;
  const target = await loadTarget(env.DB, params.id);
  const denied = guardTarget(auth, target);
  if (denied) return denied;
  if (target.role === 'admin') return jsonError('Tài khoản quản trị luôn có toàn quyền, không chỉnh riêng', 400);

  let body;
  try { body = await request.json(); } catch { return jsonError('Dữ liệu không hợp lệ', 400); }
  const overrides = body && body.overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return jsonError('Dữ liệu không hợp lệ', 400);

  const prev = await readOverrides(env.DB, target.id);
  const prevGrants = new Set(prev.filter((o) => o.effect === 'grant').map((o) => o.permission));

  const entries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, effect] of entries) {
    if (!isValidPermission(key)) return jsonError(`Mã quyền không hợp lệ: ${key}`, 400);
    if (effect !== 'grant' && effect !== 'deny') return jsonError('Dữ liệu không hợp lệ', 400);
    // Quy tắc 3 chỉ áp cho grant mới; grant đã có sẵn được giữ nguyên hoặc gỡ bỏ tự do.
    if (effect === 'grant' && !prevGrants.has(key) && !hasPermission(auth, key)) {
      return jsonError(`Không thể cấp quyền mà bạn không có: ${key}`, 403);
    }
  }

  const fmt = (list) => list.map(([k, e]) => `${k}:${e}`).join(',');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_permission_overrides WHERE staff_id = ?').bind(target.id),
    ...entries.map(([k, e]) => env.DB.prepare('INSERT INTO user_permission_overrides (staff_id, permission, effect) VALUES (?, ?, ?)').bind(target.id, k, e)),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('user_permissions_change', 'staff_account', ?, ?, ?, ?, ?, ?)`
    ).bind(target.id, target.username, fmt(prev.map((o) => [o.permission, o.effect])), fmt(entries), auth.username, new Date().toISOString()),
  ]);
  return json({ ok: true });
}
