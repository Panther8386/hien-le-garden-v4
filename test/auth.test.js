import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  createPending2FAToken,
  getPendingStaffId,
  deletePendingToken,
} from '../lib/auth.js';
import { ROLE_DEFAULTS } from '../lib/permissions.js';
import { setOverride } from './helpers/permissions.js';

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password against its hash', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
  });
});

describe('createSession / getSession', () => {
  it('creates a session that resolves back to the staff account', async () => {
    await env.DB.prepare(
      `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
       VALUES (1, 'le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`
    ).run();

    const token = await createSession(env.DB, 1);
    const session = await getSession(env.DB, token);
    expect(session).toEqual({ staffId: 1, username: 'le_tan_a', role: 'reception', permissions: new Set(ROLE_DEFAULTS.reception), totpEnabled: false });
  });

  it('resolves finance.create permission true for an account with the override set', async () => {
    await env.DB.prepare(
      `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
       VALUES (2, 'le_tan_c', 'x', 'reception', '2026-08-01T00:00:00Z')`
    ).run();
    await setOverride(env.DB, 2, 'finance.create');

    const token = await createSession(env.DB, 2);
    const session = await getSession(env.DB, token);
    expect(session.permissions.has('finance.create')).toBe(true);
  });

  it('resolves totpEnabled true for an account with 2FA turned on', async () => {
    await env.DB.prepare(
      `INSERT INTO staff_accounts (id, username, password_hash, role, totp_secret, totp_enabled, created_at)
       VALUES (3, 'le_tan_e', 'x', 'reception', 'SECRET', 1, '2026-08-01T00:00:00Z')`
    ).run();

    const token = await createSession(env.DB, 3);
    const session = await getSession(env.DB, token);
    expect(session.totpEnabled).toBe(true);
  });

  it('returns null for an unknown token', async () => {
    expect(await getSession(env.DB, 'does-not-exist')).toBeNull();
  });
});

describe('createPending2FAToken / getPendingStaffId / deletePendingToken', () => {
  async function insertStaff() {
    await env.DB.prepare(
      `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
       VALUES (10, 'le_tan_d', 'x', 'reception', '2026-08-01T00:00:00Z')`
    ).run();
  }

  it('resolves back to the staff id it was created for', async () => {
    await insertStaff();
    const token = await createPending2FAToken(env.DB, 10);
    expect(await getPendingStaffId(env.DB, token)).toBe(10);
  });

  it('returns null for an unknown token', async () => {
    expect(await getPendingStaffId(env.DB, 'does-not-exist')).toBeNull();
  });

  it('returns null once the token has expired', async () => {
    await insertStaff();
    const token = await createPending2FAToken(env.DB, 10, 10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await getPendingStaffId(env.DB, token)).toBeNull();
  });

  it('returns null after the token has been deleted', async () => {
    await insertStaff();
    const token = await createPending2FAToken(env.DB, 10);
    await deletePendingToken(env.DB, token);
    expect(await getPendingStaffId(env.DB, token)).toBeNull();
  });
});
