import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM room_layout_log');
});

describe('room status filters schema', () => {
  it('bookings.deposit_amount defaults to 0', async () => {
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('A', '090', 'circle', '2026-09-01', '2026-09-02', 'pending', 'website', '2026-08-27T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT deposit_amount FROM bookings WHERE guest_name = 'A'`).first();
    expect(row.deposit_amount).toBe(0);
  });

  it('staff_accounts.can_manage_room_layout defaults to 0', async () => {
    await env.DB.prepare(
      `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('flag_test', 'x', 'reception', '2026-08-27T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT can_manage_room_layout FROM staff_accounts WHERE username = 'flag_test'`).first();
    expect(row.can_manage_room_layout).toBe(0);
    await env.DB.prepare(`DELETE FROM staff_accounts WHERE username = 'flag_test'`).run();
  });

  it('room_layout_log accepts a row', async () => {
    await env.DB.prepare(
      `INSERT INTO room_layout_log (changed_by, old_order, new_order, changed_at) VALUES ('tester', '[1,2]', '[2,1]', '2026-08-27T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT changed_by, old_order, new_order FROM room_layout_log WHERE changed_by = 'tester'`).first();
    expect(row).toEqual({ changed_by: 'tester', old_order: '[1,2]', new_order: '[2,1]' });
  });
});
