import { effectivePermissions } from './permissions.js';

const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function deriveKey(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufferToHex(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, saltBytes);
  return `${bufferToHex(saltBytes)}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, expectedHash] = stored.split(':');
  const actualHash = await deriveKey(password, hexToBuffer(saltHex));
  return timingSafeEqual(actualHash, expectedHash);
}

export async function createSession(db, staffId) {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db
    .prepare(`INSERT INTO sessions (token, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(token, staffId, now.toISOString(), expiresAt.toISOString())
    .run();
  return token;
}

const PENDING_2FA_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const MAX_2FA_ATTEMPTS = 5;

// Token chờ 2FA có dạng `${uuid}.${attempts}` — attempts = số mã sai đã dùng
// trong lượt đăng nhập này. Chỉ server INSERT dòng vào pending_2fa_tokens, nên
// hậu tố của một token CÓ trong bảng là đáng tin (client sửa hậu tố → token
// không tồn tại → bị từ chối).
// Tham số thứ ba: số (ttlMs, tương thích cũ) hoặc { attempts, expiresAt, ttlMs }.
// Khi xoay token sau mã sai, truyền expiresAt cũ để KHÔNG kéo dài TTL.
export async function createPending2FAToken(db, staffId, options = PENDING_2FA_TTL_MS) {
  const opts = typeof options === 'number' ? { ttlMs: options } : options || {};
  const attempts = opts.attempts ?? 0;
  const now = new Date();
  const expiresAt = opts.expiresAt ?? new Date(now.getTime() + (opts.ttlMs ?? PENDING_2FA_TTL_MS)).toISOString();
  const token = `${crypto.randomUUID()}.${attempts}`;
  await db
    .prepare(`INSERT INTO pending_2fa_tokens (token, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(token, staffId, now.toISOString(), expiresAt)
    .run();
  return token;
}

// Số lần sai từ hậu tố token: không có '.' (token cũ) → 0; hậu tố đúng một chữ
// số 0..(MAX-1) → số đó; còn lại → null (không hợp lệ).
export function parsePendingAttempts(token) {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return 0;
  const suffix = token.slice(dot + 1);
  if (!/^[0-9]$/.test(suffix)) return null;
  const attempts = Number(suffix);
  return attempts < MAX_2FA_ATTEMPTS ? attempts : null;
}

// Tiêu thụ token MỘT LẦN, nguyên tử: một câu DELETE ... RETURNING duy nhất, nên
// trong các request song song cùng token chỉ đúng một request nhận được dòng.
// Trả về { staffId, expiresAt, attempts } hoặc null (không có / hết hạn /
// hậu tố không hợp lệ — dòng có hậu tố sai vẫn bị xoá).
export async function consumePendingToken(db, token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) return null;
  const row = await db
    .prepare(
      `DELETE FROM pending_2fa_tokens WHERE token = ? AND expires_at > ? RETURNING staff_id AS staffId, expires_at AS expiresAt`
    )
    .bind(token, new Date().toISOString())
    .first();
  if (!row) return null;
  const attempts = parsePendingAttempts(token);
  if (attempts === null) return null;
  return { staffId: row.staffId, expiresAt: row.expiresAt, attempts };
}

export async function getPendingStaffId(db, token) {
  const row = await db
    .prepare(`SELECT staff_id AS staffId FROM pending_2fa_tokens WHERE token = ? AND expires_at > ?`)
    .bind(token, new Date().toISOString())
    .first();
  return row ? row.staffId : null;
}

export async function deletePendingToken(db, token) {
  await db.prepare(`DELETE FROM pending_2fa_tokens WHERE token = ?`).bind(token).run();
}

export async function getSession(db, token) {
  const row = await db
    .prepare(
      `SELECT s.staff_id AS staffId, a.username, a.role, a.totp_enabled AS totpEnabled,
              (SELECT group_concat(permission, ',') FROM role_permissions WHERE role = a.role) AS rolePerms,
              (SELECT group_concat(permission || ':' || effect, ',') FROM user_permission_overrides WHERE staff_id = a.id) AS overrides
       FROM sessions s
       JOIN staff_accounts a ON a.id = s.staff_id
       WHERE s.token = ? AND s.expires_at > ? AND a.locked_at IS NULL`
    )
    .bind(token, new Date().toISOString())
    .first();

  if (!row) return null;
  // group_concat trên dấu ',' và ':' giả định mã quyền không chứa hai ký tự này — được đảm bảo bởi isValidPermission.
  const rolePerms = row.rolePerms ? row.rolePerms.split(',') : [];
  const overrides = row.overrides
    ? row.overrides.split(',').map((pair) => {
        const [permission, effect] = pair.split(':');
        return { permission, effect };
      })
    : [];
  const permissions = effectivePermissions(row.role, rolePerms, overrides);
  return {
    staffId: row.staffId,
    username: row.username,
    role: row.role,
    totpEnabled: !!row.totpEnabled,
    permissions,
  };
}
