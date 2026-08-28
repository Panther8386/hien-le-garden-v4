import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getReminders } from '../lib/receptionReminders.js';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('DELETE FROM reminder_settings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0, needs_cleaning_since = NULL');
  await env.DB.prepare(`INSERT INTO reminder_settings (pending_deposit_hours, cleaning_minutes, updated_at) VALUES (2, 60, '2026-08-01T00:00:00Z')`).run();
});

describe('getReminders', () => {
  it('returns empty lists when there is nothing to flag', async () => {
    const result = await getReminders(env);
    expect(result.pendingNoDeposit).toEqual([]);
    expect(result.arrivingToday).toEqual([]);
    expect(result.roomsNotCleaned).toEqual([]);
    expect(result.thresholds).toEqual({ pendingDepositHours: 2, cleaningMinutes: 60 });
  });

  it('flags a pending booking older than the deposit threshold with no deposit', async () => {
    const old = new Date(Date.now() - 3 * 3600000).toISOString();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, deposit_amount, created_at)
       VALUES ('Old Pending', '090', 'circle', '2099-01-01', '2099-01-03', 'pending', 'website', 0, ?)`
    ).bind(old).run();

    const result = await getReminders(env);
    expect(result.pendingNoDeposit.length).toBe(1);
    expect(result.pendingNoDeposit[0].guestName).toBe('Old Pending');
    expect(result.pendingNoDeposit[0].hoursWaiting).toBeGreaterThanOrEqual(3);
  });

  it('does not flag a pending booking younger than the deposit threshold', async () => {
    const recent = new Date(Date.now() - 30 * 60000).toISOString();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, deposit_amount, created_at)
       VALUES ('Recent Pending', '090', 'circle', '2099-01-01', '2099-01-03', 'pending', 'website', 0, ?)`
    ).bind(recent).run();

    const result = await getReminders(env);
    expect(result.pendingNoDeposit).toEqual([]);
  });

  it('does not flag an old pending booking that already has a deposit', async () => {
    const old = new Date(Date.now() - 3 * 3600000).toISOString();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, deposit_amount, created_at)
       VALUES ('Deposited', '090', 'circle', '2099-01-01', '2099-01-03', 'pending', 'website', 100000, ?)`
    ).bind(old).run();

    const result = await getReminders(env);
    expect(result.pendingNoDeposit).toEqual([]);
  });

  it('does not flag an old confirmed booking (not pending) even without a deposit', async () => {
    const old = new Date(Date.now() - 3 * 3600000).toISOString();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, deposit_amount, created_at)
       VALUES ('Confirmed No Deposit', '090', 'circle', '2099-01-01', '2099-01-03', 'confirmed', 'website', 0, ?)`
    ).bind(old).run();

    const result = await getReminders(env);
    expect(result.pendingNoDeposit).toEqual([]);
  });

  it('flags a confirmed booking checking in today', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Arriving Today', '090', 'circle', ?, '2099-01-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(today).run();

    const result = await getReminders(env);
    expect(result.arrivingToday.length).toBe(1);
    expect(result.arrivingToday[0].guestName).toBe('Arriving Today');
  });

  it('does not flag a confirmed booking checking in tomorrow', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Arriving Tomorrow', '090', 'circle', ?, '2099-01-03', 'confirmed', 'website', '2026-08-01T00:00:00Z')`
    ).bind(tomorrow).run();

    const result = await getReminders(env);
    expect(result.arrivingToday).toEqual([]);
  });

  it('does not flag a pending booking checking in today (not yet confirmed)', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Still Pending', '090', 'circle', ?, '2099-01-03', 'pending', 'website', '2026-08-01T00:00:00Z')`
    ).bind(today).run();

    const result = await getReminders(env);
    expect(result.arrivingToday).toEqual([]);
  });

  it('flags a room whose needs_cleaning_since is older than the cleaning threshold', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    const old = new Date(Date.now() - 90 * 60000).toISOString();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = ? WHERE id = ?`).bind(old, room.id).run();

    const result = await getReminders(env);
    expect(result.roomsNotCleaned.length).toBe(1);
    expect(result.roomsNotCleaned[0].id).toBe(room.id);
    expect(result.roomsNotCleaned[0].minutesWaiting).toBeGreaterThanOrEqual(90);
  });

  it('does not flag a room whose needs_cleaning_since is within the cleaning threshold', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    const recent = new Date(Date.now() - 10 * 60000).toISOString();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = ? WHERE id = ?`).bind(recent, room.id).run();

    const result = await getReminders(env);
    expect(result.roomsNotCleaned).toEqual([]);
  });

  it('does not flag a room with needs_cleaning = 0 regardless of needs_cleaning_since', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    const old = new Date(Date.now() - 90 * 60000).toISOString();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 0, needs_cleaning_since = ? WHERE id = ?`).bind(old, room.id).run();

    const result = await getReminders(env);
    expect(result.roomsNotCleaned).toEqual([]);
  });

  it('does not flag a room with needs_cleaning = 1 but a NULL needs_cleaning_since (historical gap)', async () => {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = NULL WHERE id = ?`).bind(room.id).run();

    const result = await getReminders(env);
    expect(result.roomsNotCleaned).toEqual([]);
  });

  it('respects a configured threshold different from the default', async () => {
    await env.DB.exec('DELETE FROM reminder_settings');
    await env.DB.prepare(`INSERT INTO reminder_settings (pending_deposit_hours, cleaning_minutes, updated_at) VALUES (1, 20, '2026-08-27T00:00:00Z')`).run();

    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = 'circle' ORDER BY id LIMIT 1`).first();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60000).toISOString();
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = ? WHERE id = ?`).bind(thirtyMinAgo, room.id).run();

    // 30 minutes ago is older than a 20-minute threshold, so this now flags -- it would NOT
    // have flagged under the default 60-minute threshold, proving the configured value is read.
    const result = await getReminders(env);
    expect(result.roomsNotCleaned.length).toBe(1);
    expect(result.thresholds).toEqual({ pendingDepositHours: 1, cleaningMinutes: 20 });
  });

  it('falls back to the 2/60 default when reminder_settings is empty', async () => {
    await env.DB.exec('DELETE FROM reminder_settings');
    const result = await getReminders(env);
    expect(result.thresholds).toEqual({ pendingDepositHours: 2, cleaningMinutes: 60 });
  });
});
