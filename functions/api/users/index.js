import { requireAuth } from '../../../lib/requireAuth.js';
import { hashPassword } from '../../../lib/auth.js';
import { missingRolePermissions } from '../../../lib/staffGuards.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT id, username, role, totp_enabled AS totpEnabled, locked_at AS lockedAt, created_at AS createdAt,
            (SELECT COUNT(*) FROM user_permission_overrides o WHERE o.staff_id = staff_accounts.id) AS overrideCount
     FROM staff_accounts ORDER BY username`
  ).all();

  const users = results.map((u) => ({ ...u, totpEnabled: !!u.totpEnabled }));
  return new Response(JSON.stringify(users), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { username, password, role } = body;

  if (typeof username !== 'string' || username.trim().length === 0) {
    return jsonError('Tên đăng nhập không được để trống', 400);
  }
  if (!['manager', 'reception', 'admin', 'observer'].includes(role)) {
    return jsonError('Vai trò phải là manager, reception, admin hoặc observer', 400);
  }
  if (role === 'admin' && auth.role !== 'admin') {
    return jsonError('Chỉ quản trị mới được gán vai trò quản trị', 403);
  }
  if ((await missingRolePermissions(env.DB, auth, role)).length > 0) {
    return jsonError('Không thể gán vai trò có quyền mà bạn không có', 403);
  }
  if (typeof password !== 'string' || password.length < 8) {
    return jsonError('Mật khẩu phải có ít nhất 8 ký tự', 400);
  }

  const existing = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE username = ?`).bind(username).first();
  if (existing) {
    return jsonError('Tên đăng nhập đã tồn tại', 409);
  }

  const passwordHash = await hashPassword(password);
  const result = await env.DB.prepare(
    `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(username, passwordHash, role, new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
