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

export async function createPending2FAToken(db, staffId, ttlMs = PENDING_2FA_TTL_MS) {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db
    .prepare(`INSERT INTO pending_2fa_tokens (token, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(token, staffId, now.toISOString(), expiresAt.toISOString())
    .run();
  return token;
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
  const rolePerms = row.rolePerms ? row.rolePerms.split(',') : [];
  const overrides = row.overrides
    ? row.overrides.split(',').map((pair) => {
        const [permission, effect] = pair.split(':');
        return { permission, effect };
      })
    : [];
  // group_concat trên dấu ',' và ':' giả định mã quyền không chứa hai ký tự này — được đảm bảo bởi isValidPermission.
  const permissions = effectivePermissions(row.role, rolePerms, overrides);
  return {
    staffId: row.staffId,
    username: row.username,
    role: row.role,
    totpEnabled: !!row.totpEnabled,
    permissions,
  };
}
