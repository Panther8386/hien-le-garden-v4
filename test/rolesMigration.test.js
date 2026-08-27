import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
});

describe('staff_accounts.role CHECK constraint', () => {
  it('accepts admin and observer roles', async () => {
    await env.DB.prepare(
      `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_a', 'x', 'admin', '2026-08-27T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('observer_a', 'x', 'observer', '2026-08-27T00:00:00Z')`
    ).run();
    const { results } = await env.DB.prepare(`SELECT username, role FROM staff_accounts ORDER BY username`).all();
    expect(results).toEqual([
      { username: 'admin_a', role: 'admin' },
      { username: 'observer_a', role: 'observer' },
    ]);
  });

  it('still rejects an invalid role', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('bad', 'x', 'superuser', '2026-08-27T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });
});
