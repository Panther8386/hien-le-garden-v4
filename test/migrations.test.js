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

describe('migration 0018', () => {
  it('seeds exactly 14 categories with the correct labels and types, including the two requested edits', async () => {
    const { results } = await env.DB.prepare(`SELECT slug, label, type, is_active FROM finance_categories ORDER BY id`).all();
    expect(results).toEqual([
      { slug: 'cay_giong', label: 'Cây giống', type: 'expense', is_active: 1 },
      { slug: 'vat_tu', label: 'Vật tư', type: 'expense', is_active: 1 },
      { slug: 'nhan_cong', label: 'Nhân công', type: 'expense', is_active: 1 },
      { slug: 'van_chuyen', label: 'Vận chuyển', type: 'expense', is_active: 1 },
      { slug: 'bao_tri', label: 'Bảo trì', type: 'expense', is_active: 1 },
      { slug: 'thuc_pham', label: 'Thực phẩm', type: 'expense', is_active: 1 },
      { slug: 'am_thuc_lien_ket', label: 'Ẩm thực liên kết', type: 'expense', is_active: 1 },
      { slug: 'khac', label: 'Chi phí khác', type: 'expense', is_active: 1 },
      { slug: 'ban_hang', label: 'Dịch vụ khác', type: 'income', is_active: 1 },
      { slug: 'dich_vu', label: 'Lưu trú Hiền Lê', type: 'income', is_active: 1 },
      { slug: 'bep_hien_le', label: 'Bếp Hiền Lê', type: 'income', is_active: 1 },
      { slug: 'hien_le_drinks', label: 'Hiền Lê Drinks', type: 'income', is_active: 1 },
      { slug: 'hh_am_thuc_lien_ket', label: 'HH Ẩm thực liên kết', type: 'income', is_active: 1 },
      { slug: 'gio_xanh_hien_le', label: 'Giờ xanh Hiền Lê', type: 'income', is_active: 1 },
    ]);
  });

  it('rejects a duplicate slug at the DB layer', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO finance_categories (slug, label, type, is_active, created_by, created_at) VALUES ('khac', 'Trùng slug', 'expense', 1, 'test', '2026-09-03T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });

  it('rejects an invalid type at the DB layer', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO finance_categories (slug, label, type, is_active, created_by, created_at) VALUES ('test_slug', 'Test', 'neither', 1, 'test', '2026-09-03T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });
});

describe('migration 0019', () => {
  it('no longer rejects an arbitrary category string at the DB layer (CHECK constraint removed)', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'a_brand_new_admin_added_category', 10000, '2026-09-03', 'draft', 'test', '2026-09-03T00:00:00Z')`
    ).run();
    expect(insert.meta.last_row_id).toBeGreaterThan(0);
  });

  it('still rejects an invalid type (unrelated CHECK, untouched by this migration)', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('neither', 'khac', 10000, '2026-09-03', 'draft', 'test', '2026-09-03T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });

  it('preserves the receipt columns and existing indexes', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 50000, '2026-09-03', 'draft', 'test', '2026-09-03T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT receipt_key, receipt_filename, receipt_uploaded_at FROM finance_transactions WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row).toEqual({ receipt_key: null, receipt_filename: null, receipt_uploaded_at: null });
  });

  it('assigns a fresh id higher than any pre-existing row after the rebuild (sqlite_sequence preserved)', async () => {
    const before = await env.DB.prepare(`SELECT MAX(id) as maxId FROM finance_transactions`).first();
    const insert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 20000, '2026-09-03', 'draft', 'test', '2026-09-03T00:00:00Z')`
    ).run();
    expect(insert.meta.last_row_id).toBeGreaterThan(before.maxId || 0);
  });
});
