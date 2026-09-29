// lib/staffGuards.js
// Quy tắc an toàn dùng chung cho các API sửa tài khoản khác (spec mục 7).
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function loadTarget(db, id) {
  return db.prepare(`SELECT id, username, role, locked_at AS lockedAt FROM staff_accounts WHERE id = ?`).bind(id).first();
}

// Quy tắc 7 (FA-1): thứ bậc tài khoản, độc lập với quyền users.*.
const ROLE_RANK = { admin: 3, manager: 2, reception: 1, observer: 1 };
export const HIERARCHY_ERROR = 'Không thể thao tác trên tài khoản cùng cấp hoặc cấp cao hơn';

export function roleRank(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, role) ? ROLE_RANK[role] : 0;
}

// Người không phải admin chỉ thao tác / gán được vai trò có cấp thấp hơn mình.
// Vai trò lạ ở phía target được coi là cao nhất (từ chối), ở phía actor là thấp nhất.
export function outranks(auth, role) {
  if (auth.role === 'admin') return true;
  if (!Object.prototype.hasOwnProperty.call(ROLE_RANK, role)) return false;
  return roleRank(role) < roleRank(auth.role);
}

// Trả Response lỗi, hoặc null nếu được phép thao tác trên target.
export function guardTarget(auth, target, { allowSelf = false } = {}) {
  if (!target) return jsonError('Không tìm thấy tài khoản', 404);
  const isSelf = target.id === auth.staffId;
  if (!allowSelf && isSelf) return jsonError('Không thể tự thao tác trên tài khoản của chính mình', 400);
  if (target.role === 'admin' && auth.role !== 'admin') return jsonError('Chỉ quản trị mới được sửa tài khoản quản trị', 403);
  // Tự thao tác (khi allowSelf) giữ nguyên như trước, không áp thứ bậc.
  if (!isSelf && !outranks(auth, target.role)) return jsonError(HIERARCHY_ERROR, 403);
  return null;
}

// Khoá do admin (hoặc không rõ ai khoá: tài khoản khoá đã bị xoá / locked_by NULL)
// chỉ admin mở được. Trả Response lỗi hoặc null.
export async function guardAdminLock(db, auth, targetId) {
  if (auth.role === 'admin') return null;
  const row = await db.prepare(
    `SELECT l.role AS lockerRole FROM staff_accounts t LEFT JOIN staff_accounts l ON l.username = t.locked_by WHERE t.id = ?`
  ).bind(targetId).first();
  if (!row || !row.lockerRole || row.lockerRole === 'admin') {
    return jsonError('Tài khoản bị quản trị viên khoá, chỉ quản trị viên mới mở khoá được', 403);
  }
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
