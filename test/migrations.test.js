import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('migration 0003', () => {
  it('creates message_templates with two active seed rows', async () => {
    const { results } = await env.DB.prepare(
      `SELECT channel, is_active FROM message_templates ORDER BY channel`
    ).all();
    expect(results).toEqual([
      { channel: 'email', is_active: 1 },
      { channel: 'telegram', is_active: 1 },
    ]);
  });

  it('creates an empty message_log table', async () => {
    const { results } = await env.DB.prepare(`SELECT * FROM message_log`).all();
    expect(results).toEqual([]);
  });
});

describe('migration 0004', () => {
  it('seeds exactly 16 active rooms matching the real inventory counts', async () => {
    const { results } = await env.DB.prepare(
      `SELECT room_type, COUNT(*) as count FROM rooms WHERE is_active = 1 GROUP BY room_type ORDER BY room_type`
    ).all();
    expect(results).toEqual([
      { room_type: 'bungalow', count: 3 },
      { room_type: 'circle', count: 5 },
      { room_type: 'dormitory', count: 1 },
      { room_type: 'ede_cozy', count: 2 },
      { room_type: 'triangle', count: 3 },
      { room_type: 'vip', count: 2 },
    ]);
  });

  it('seeds no room already needing cleaning', async () => {
    const { results } = await env.DB.prepare(`SELECT COUNT(*) as count FROM rooms WHERE needs_cleaning = 1`).all();
    expect(results[0].count).toBe(0);
  });

  it('creates an empty bookings table', async () => {
    const { results } = await env.DB.prepare(`SELECT * FROM bookings`).all();
    expect(results).toEqual([]);
  });
});

describe('migration 0016', () => {
  it('accepts all 13 category slugs paired with their correct type', async () => {
    await env.DB.exec('DELETE FROM finance_transactions');
    const rows = [
      ['cay_giong', 'expense'], ['vat_tu', 'expense'], ['nhan_cong', 'expense'], ['van_chuyen', 'expense'],
      ['bao_tri', 'expense'], ['thuc_pham', 'expense'], ['am_thuc_lien_ket', 'expense'], ['khac', 'expense'],
      ['ban_hang', 'income'], ['dich_vu', 'income'], ['bep_hien_le', 'income'], ['hien_le_drinks', 'income'],
      ['hh_am_thuc_lien_ket', 'income'],
    ];
    for (const [category, type] of rows) {
      await env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES (?, ?, 10000, '2026-09-01', 'draft', 'test', '2026-09-01T00:00:00Z')`
      ).bind(type, category).run();
    }
    const { results } = await env.DB.prepare(`SELECT COUNT(*) as count FROM finance_transactions`).all();
    expect(results[0].count).toBe(13);
  });

  it('still rejects an invalid category slug', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('expense', 'not_a_real_category', 10000, '2026-09-01', 'draft', 'test', '2026-09-01T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });

  it('has the three new receipt columns, defaulting to null', async () => {
    await env.DB.exec('DELETE FROM finance_transactions');
    const insert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 50000, '2026-09-01', 'draft', 'test', '2026-09-01T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT receipt_key, receipt_filename, receipt_uploaded_at FROM finance_transactions WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row).toEqual({ receipt_key: null, receipt_filename: null, receipt_uploaded_at: null });
  });

  it('assigns a fresh id higher than any pre-existing row after the CHECK-constraint rebuild (sqlite_sequence preserved)', async () => {
    const before = await env.DB.prepare(`SELECT MAX(id) as maxId FROM finance_transactions`).first();
    const insert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 20000, '2026-09-01', 'draft', 'test', '2026-09-01T00:00:00Z')`
    ).run();
    expect(insert.meta.last_row_id).toBeGreaterThan(before.maxId || 0);
  });
});
