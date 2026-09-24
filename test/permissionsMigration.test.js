import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ROLE_DEFAULTS, EDITABLE_ROLES } from '../lib/permissions.js';

function flagConversionQueries() {
  const mig = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0042_'));
  return mig.queries.filter((q) => q.trim().startsWith('INSERT INTO user_permission_overrides'));
}

describe('0042_permissions seed', () => {
  it('seeds role_permissions exactly equal to ROLE_DEFAULTS', async () => {
    const { results } = await env.DB.prepare('SELECT role, permission FROM role_permissions').all();
    for (const role of EDITABLE_ROLES) {
      const seeded = results.filter((r) => r.role === role).map((r) => r.permission).sort();
      expect(seeded).toEqual([...ROLE_DEFAULTS[role]].sort());
    }
    expect(results.some((r) => r.role === 'admin')).toBe(false);
  });

  it('adds nullable lock columns', async () => {
    const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('m42', 'x', 'reception', '2026-09-24T00:00:00Z')`).run();
    const row = await env.DB.prepare('SELECT locked_at, locked_by FROM staff_accounts WHERE id = ?').bind(r.meta.last_row_id).first();
    expect(row).toEqual({ locked_at: null, locked_by: null });
  });
});

describe('0042_permissions legacy flag conversion', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM user_permission_overrides');
    await env.DB.exec('DELETE FROM staff_accounts');
    await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at, can_manage_room_layout, can_add_finance_transaction, can_delete_asset, can_delete_deposit)
      VALUES (1, 'lt', 'x', 'reception', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (2, 'ql', 'x', 'manager', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (3, 'qs', 'x', 'observer', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (4, 'qt', 'x', 'admin', '2026-09-24T00:00:00Z', 1, 1, 1, 1),
             (5, 'lt0', 'x', 'reception', '2026-09-24T00:00:00Z', 0, 0, 0, 0)`).run();
    for (const q of flagConversionQueries()) await env.DB.prepare(q).run();
  });

  async function grantsFor(id) {
    const { results } = await env.DB.prepare(`SELECT permission, effect FROM user_permission_overrides WHERE staff_id = ? ORDER BY permission`).bind(id).all();
    return results;
  }

  it('turns all four flags into grants for reception', async () => {
    expect(await grantsFor(1)).toEqual([
      { permission: 'assets.delete', effect: 'grant' },
      { permission: 'bookings.deposit_delete', effect: 'grant' },
      { permission: 'finance.create', effect: 'grant' },
      { permission: 'rooms.layout', effect: 'grant' },
    ]);
  });

  it('skips finance.create for manager (role already has it)', async () => {
    expect((await grantsFor(2)).map((g) => g.permission)).toEqual(['assets.delete', 'bookings.deposit_delete', 'rooms.layout']);
  });

  it('skips observer and admin, and users with no flags', async () => {
    expect(await grantsFor(3)).toEqual([]);
    expect(await grantsFor(4)).toEqual([]);
    expect(await grantsFor(5)).toEqual([]);
  });
});
