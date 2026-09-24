// lib/staffGuards.js
// Quy tắc an toàn dùng chung cho các API sửa tài khoản khác (spec mục 7).
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function loadTarget(db, id) {
  return db.prepare(`SELECT id, username, role, locked_at AS lockedAt FROM staff_accounts WHERE id = ?`).bind(id).first();
}

// Trả Response lỗi, hoặc null nếu được phép thao tác trên target.
export function guardTarget(auth, target, { allowSelf = false } = {}) {
  if (!target) return jsonError('Không tìm thấy tài khoản', 404);
  if (!allowSelf && target.id === auth.staffId) return jsonError('Không thể tự thao tác trên tài khoản của chính mình', 400);
  if (target.role === 'admin' && auth.role !== 'admin') return jsonError('Chỉ quản trị mới được sửa tài khoản quản trị', 403);
  return null;
}

// Quy tắc 6: người không phải admin chỉ gán được vai trò mà họ có toàn bộ quyền.
// Trả danh sách mã quyền của vai trò mà auth không có (rỗng nếu được phép).
export async function missingRolePermissions(db, auth, role) {
  if (auth.role === 'admin') return [];
  const { results } = await db.prepare('SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission').bind(role).all();
  return results.map((r) => r.permission).filter((p) => !auth.permissions.has(p));
}

export async function isLastActiveAdmin(db, targetId) {
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'admin' AND locked_at IS NULL AND id != ?`).bind(targetId).first();
  const target = await db.prepare(`SELECT role, locked_at AS lockedAt FROM staff_accounts WHERE id = ?`).bind(targetId).first();
  return !!target && target.role === 'admin' && !target.lockedAt && n === 0;
}
