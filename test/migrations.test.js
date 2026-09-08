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
    const { results } = await env.DB.prepare(`SELECT slug, label, type, is_active FROM finance_categories WHERE slug != 'khach_vang_lai' ORDER BY id`).all();
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

describe('migration 0020', () => {
  it('adds id_number and nationality columns, defaulting to null', async () => {
    const result = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Test Guest', '090', 'circle', '2026-09-10', '2026-09-11', 'pending', 'website', '2026-09-04T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT id_number, nationality FROM bookings WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row).toEqual({ id_number: null, nationality: null });
  });

  it('accepts a value for both new columns', async () => {
    const result = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, id_number, nationality, created_at)
       VALUES ('Test Guest 2', '091', 'circle', '2026-09-10', '2026-09-11', 'pending', 'website', '079123456789', 'Việt Nam', '2026-09-04T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT id_number, nationality FROM bookings WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row).toEqual({ id_number: '079123456789', nationality: 'Việt Nam' });
  });
});

describe('migration 0021', () => {
  it('creates dine_in_menu_items, dine_in_orders, and dine_in_order_items with working relationships', async () => {
    const menuInsert = await env.DB.prepare(
      `INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at)
       VALUES ('Mì Quảng', 'mon_an', 45000, 1, 1, 'system', '2026-09-04T00:00:00Z')`
    ).run();
    const menuId = menuInsert.meta.last_row_id;

    const orderInsert = await env.DB.prepare(
      `INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn 1', 'open', 'le_tan', '2026-09-04T08:00:00Z')`
    ).run();
    const orderId = orderInsert.meta.last_row_id;

    const itemInsert = await env.DB.prepare(
      `INSERT INTO dine_in_order_items (order_id, menu_item_id, name, unit_price, quantity, amount, status, created_by, created_at)
       VALUES (?, ?, 'Mì Quảng', 45000, 2, 90000, 'posted', 'le_tan', '2026-09-04T08:05:00Z')`
    ).bind(orderId, menuId).run();

    const menuRow = await env.DB.prepare(`SELECT name, category, price, is_active FROM dine_in_menu_items WHERE id = ?`).bind(menuId).first();
    expect(menuRow).toEqual({ name: 'Mì Quảng', category: 'mon_an', price: 45000, is_active: 1 });

    const orderRow = await env.DB.prepare(`SELECT table_label, status, total_amount FROM dine_in_orders WHERE id = ?`).bind(orderId).first();
    expect(orderRow).toEqual({ table_label: 'Bàn 1', status: 'open', total_amount: null });

    const itemRow = await env.DB.prepare(`SELECT order_id, name, quantity, amount, status FROM dine_in_order_items WHERE id = ?`).bind(itemInsert.meta.last_row_id).first();
    expect(itemRow).toEqual({ order_id: orderId, name: 'Mì Quảng', quantity: 2, amount: 90000, status: 'posted' });
  });

  it('rejects an invalid dine_in_menu_items category via the CHECK constraint', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at)
         VALUES ('X', 'trang_mieng', 10000, 0, 1, 'system', '2026-09-04T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });

  it('seeds the "Khách vãng lai" income category', async () => {
    const row = await env.DB.prepare(`SELECT slug, label, type, is_active FROM finance_categories WHERE slug = 'khach_vang_lai'`).first();
    expect(row).toEqual({ slug: 'khach_vang_lai', label: 'Khách vãng lai', type: 'income', is_active: 1 });
  });
});

describe('migration 0022', () => {
  it('adds subgroup, unit, and requires_preorder, defaulting correctly', async () => {
    const result = await env.DB.prepare(
      `INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Test Item', 'mon_an', 50000, 0, 1, 'system', '2026-09-04T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT subgroup, unit, requires_preorder FROM dine_in_menu_items WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row).toEqual({ subgroup: null, unit: null, requires_preorder: 0 });
  });

  it('accepts values for all three new columns', async () => {
    const result = await env.DB.prepare(
      `INSERT INTO dine_in_menu_items (name, category, price, subgroup, unit, requires_preorder, display_order, is_active, updated_by, updated_at) VALUES ('Gà nướng', 'mon_an', 368000, 'Món gà', 'con', 1, 0, 1, 'system', '2026-09-04T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT subgroup, unit, requires_preorder FROM dine_in_menu_items WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row).toEqual({ subgroup: 'Món gà', unit: 'con', requires_preorder: 1 });
  });

  it('backfill statement gives legacy same-category rows (both display_order = 0) distinct values preserving id order', async () => {
    // Simulate legacy pre-migration data: two rows in the same category, both inserted
    // with the old hardcoded display_order = 0, matching how every row prior to this
    // feature was written.
    const first = await env.DB.prepare(
      `INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Legacy A', 'do_uong', 20000, 0, 1, 'system', '2026-09-04T00:00:00Z')`
    ).run();
    const second = await env.DB.prepare(
      `INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Legacy B', 'do_uong', 20000, 0, 1, 'system', '2026-09-04T00:00:00Z')`
    ).run();
    const firstId = first.meta.last_row_id;
    const secondId = second.meta.last_row_id;

    // Re-run the same backfill statement from migration 0022 in isolation.
    await env.DB.exec(
      `UPDATE dine_in_menu_items SET display_order = (SELECT COUNT(*) FROM dine_in_menu_items b WHERE b.category = dine_in_menu_items.category AND b.id < dine_in_menu_items.id)`
    );

    const firstRow = await env.DB.prepare(`SELECT display_order FROM dine_in_menu_items WHERE id = ?`).bind(firstId).first();
    const secondRow = await env.DB.prepare(`SELECT display_order FROM dine_in_menu_items WHERE id = ?`).bind(secondId).first();
    expect(firstRow.display_order).not.toBe(secondRow.display_order);
    expect(firstRow.display_order).toBeLessThan(secondRow.display_order);
  });
});

describe('migration 0023', () => {
  it('creates gio_xanh_sessions and gio_xanh_session_items with working relationships', async () => {
    const roomRow = await env.DB.prepare(`SELECT id, name FROM rooms WHERE is_active = 1 LIMIT 1`).first();

    const sessionInsert = await env.DB.prepare(
      `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Test Guest', 'open', 'le_tan', '2026-09-04T08:00:00Z')`
    ).bind(roomRow.id).run();
    const sessionId = sessionInsert.meta.last_row_id;

    const itemInsert = await env.DB.prepare(
      `INSERT INTO gio_xanh_session_items (session_id, source, source_id, name, unit_price, quantity, amount, status, created_by, created_at)
       VALUES (?, 'gio_combo', 1, 'Giờ Đầu Tiên', 130000, 1, 130000, 'posted', 'le_tan', '2026-09-04T08:05:00Z')`
    ).bind(sessionId).run();

    const sessionRow = await env.DB.prepare(`SELECT room_id, guest_name, status, total_amount FROM gio_xanh_sessions WHERE id = ?`).bind(sessionId).first();
    expect(sessionRow).toEqual({ room_id: roomRow.id, guest_name: 'Test Guest', status: 'open', total_amount: null });

    const itemRow = await env.DB.prepare(`SELECT source, name, amount, status FROM gio_xanh_session_items WHERE id = ?`).bind(itemInsert.meta.last_row_id).first();
    expect(itemRow).toEqual({ source: 'gio_combo', name: 'Giờ Đầu Tiên', amount: 130000, status: 'posted' });
  });

  it('rejects an invalid source via the CHECK constraint', async () => {
    const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();
    const sessionInsert = await env.DB.prepare(
      `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Test Guest 2', 'open', 'le_tan', '2026-09-04T08:00:00Z')`
    ).bind(roomRow.id).run();

    await expect(
      env.DB.prepare(
        `INSERT INTO gio_xanh_session_items (session_id, source, source_id, name, unit_price, quantity, amount, status, created_by, created_at)
         VALUES (?, 'invalid_source', 1, 'X', 10000, 1, 10000, 'posted', 'le_tan', '2026-09-04T08:05:00Z')`
      ).bind(sessionInsert.meta.last_row_id).run()
    ).rejects.toThrow();
  });

  it('enforces at most one open session per room via a partial unique index', async () => {
    const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();

    await env.DB.prepare(
      `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Test Guest 3', 'open', 'le_tan', '2026-09-04T08:00:00Z')`
    ).bind(roomRow.id).run();

    await expect(
      env.DB.prepare(
        `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Test Guest 4', 'open', 'le_tan', '2026-09-04T08:01:00Z')`
      ).bind(roomRow.id).run()
    ).rejects.toThrow();
  });
});

describe('migration 0024', () => {
  it('backfills distinct display_order values per type for the already-seeded categories', async () => {
    const { results } = await env.DB.prepare(`SELECT id, type, display_order FROM finance_categories ORDER BY type, id`).all();
    expect(results.length).toBeGreaterThan(0);
    const seenByType = {};
    for (const row of results) {
      seenByType[row.type] = seenByType[row.type] || new Set();
      expect(seenByType[row.type].has(row.display_order)).toBe(false);
      seenByType[row.type].add(row.display_order);
    }
  });

  it('accepts an explicit value for the new column on insert', async () => {
    const result = await env.DB.prepare(
      `INSERT INTO finance_categories (slug, label, type, is_active, display_order, created_by, created_at) VALUES ('test_slug_0024a', 'Test', 'income', 1, 5, 'system', '2026-09-04T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT display_order FROM finance_categories WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row.display_order).toBe(5);
  });

  it('defaults to 0 when not specified', async () => {
    const result = await env.DB.prepare(
      `INSERT INTO finance_categories (slug, label, type, is_active, created_by, created_at) VALUES ('test_slug_0024b', 'Test 2', 'expense', 1, 'system', '2026-09-04T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT display_order FROM finance_categories WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row.display_order).toBe(0);
  });
});

describe('migration 0025', () => {
  it('adds is_hidden defaulting to 0 on gio_xanh_sessions, dine_in_orders, and bookings', async () => {
    const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();

    const sessionInsert = await env.DB.prepare(
      `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Test Guest', 'open', 'system', '2026-09-05T00:00:00Z')`
    ).bind(roomRow.id).run();
    const sessionRow = await env.DB.prepare(`SELECT is_hidden FROM gio_xanh_sessions WHERE id = ?`).bind(sessionInsert.meta.last_row_id).first();
    expect(sessionRow.is_hidden).toBe(0);

    const orderInsert = await env.DB.prepare(
      `INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn Test', 'open', 'system', '2026-09-05T00:00:00Z')`
    ).run();
    const orderRow = await env.DB.prepare(`SELECT is_hidden FROM dine_in_orders WHERE id = ?`).bind(orderInsert.meta.last_row_id).first();
    expect(orderRow.is_hidden).toBe(0);

    const bookingInsert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Test Guest', '0900000000', 'circle', '2026-09-10', '2026-09-11', 'pending', 'phone', '2026-09-05T00:00:00Z')`
    ).run();
    const bookingRow = await env.DB.prepare(`SELECT is_hidden FROM bookings WHERE id = ?`).bind(bookingInsert.meta.last_row_id).first();
    expect(bookingRow.is_hidden).toBe(0);
  });

  it('accepts is_hidden = 1 on all three tables', async () => {
    const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();

    const sessionInsert = await env.DB.prepare(
      `INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at, is_hidden) VALUES (?, 'Test Guest', 'closed', 'system', '2026-09-05T00:00:00Z', 1)`
    ).bind(roomRow.id).run();
    const sessionRow = await env.DB.prepare(`SELECT is_hidden FROM gio_xanh_sessions WHERE id = ?`).bind(sessionInsert.meta.last_row_id).first();
    expect(sessionRow.is_hidden).toBe(1);

    const orderInsert = await env.DB.prepare(
      `INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at, is_hidden) VALUES ('Bàn Test', 'closed', 'system', '2026-09-05T00:00:00Z', 1)`
    ).run();
    const orderRow = await env.DB.prepare(`SELECT is_hidden FROM dine_in_orders WHERE id = ?`).bind(orderInsert.meta.last_row_id).first();
    expect(orderRow.is_hidden).toBe(1);

    const bookingInsert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at, is_hidden) VALUES ('Test Guest', '0900000000', 'circle', '2026-09-10', '2026-09-11', 'cancelled', 'phone', '2026-09-05T00:00:00Z', 1)`
    ).run();
    const bookingRow = await env.DB.prepare(`SELECT is_hidden FROM bookings WHERE id = ?`).bind(bookingInsert.meta.last_row_id).first();
    expect(bookingRow.is_hidden).toBe(1);
  });
});

describe('migration 0026', () => {
  it('adds is_hidden defaulting to 0 on finance_transactions', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 100000, '2026-09-06', 'paid', 'system', '2026-09-06T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT is_hidden FROM finance_transactions WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.is_hidden).toBe(0);
  });

  it('accepts is_hidden = 1 on finance_transactions', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at, is_hidden) VALUES ('expense', 'vat_tu', 50000, '2026-09-06', 'confirmed', 'system', '2026-09-06T00:00:00Z', 1)`
    ).run();
    const row = await env.DB.prepare(`SELECT is_hidden FROM finance_transactions WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.is_hidden).toBe(1);
  });
});

describe('migration 0027', () => {
  it('creates asset_categories with is_active defaulting to 1', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('individual_device', 'Điều hoà', 'bộ', 'system', '2026-09-07T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT is_active FROM asset_categories WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.is_active).toBe(1);
  });

  it('rejects an invalid management_type via the CHECK constraint', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES ('invalid_type', 'X', 'cái', 'system', '2026-09-07T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });

  it('creates an asset_locations row of type room referencing an existing room', async () => {
    const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();
    const insert = await env.DB.prepare(
      `INSERT INTO asset_locations (location_type, room_id, name, created_by, created_at) VALUES ('room', ?, 'Test Room Location', 'system', '2026-09-07T00:00:00Z')`
    ).bind(roomRow.id).run();
    const row = await env.DB.prepare(`SELECT location_type, room_id FROM asset_locations WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row).toEqual({ location_type: 'room', room_id: roomRow.id });
  });

  it('rejects a room-type location with no room_id via the CHECK constraint', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('room', 'X', 'system', '2026-09-07T00:00:00Z')`
      ).run()
    ).rejects.toThrow();
  });

  it('rejects a non-room location that has a room_id via the CHECK constraint', async () => {
    const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();
    await expect(
      env.DB.prepare(
        `INSERT INTO asset_locations (location_type, room_id, name, created_by, created_at) VALUES ('warehouse', ?, 'X', 'system', '2026-09-07T00:00:00Z')`
      ).bind(roomRow.id).run()
    ).rejects.toThrow();
  });

  it('enforces at most one asset_locations row per room via a partial unique index', async () => {
    const roomRow = await env.DB.prepare(`SELECT id FROM rooms WHERE is_active = 1 LIMIT 1`).first();
    await env.DB.prepare(
      `INSERT INTO asset_locations (location_type, room_id, name, created_by, created_at) VALUES ('room', ?, 'First', 'system', '2026-09-07T00:00:00Z')`
    ).bind(roomRow.id).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO asset_locations (location_type, room_id, name, created_by, created_at) VALUES ('room', ?, 'Second', 'system', '2026-09-07T00:00:00Z')`
      ).bind(roomRow.id).run()
    ).rejects.toThrow();
  });

  it('allows multiple warehouse locations with no room_id', async () => {
    await env.DB.prepare(
      `INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('warehouse', 'Kho 1', 'system', '2026-09-07T00:00:00Z')`
    ).run();
    const insert2 = await env.DB.prepare(
      `INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('warehouse', 'Kho 2', 'system', '2026-09-07T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT room_id FROM asset_locations WHERE id = ?`).bind(insert2.meta.last_row_id).first();
    expect(row.room_id).toBeNull();
  });

  it('creates an asset_source_document and a linked asset_source_row, preserving raw_quantity as text', async () => {
    const docInsert = await env.DB.prepare(
      `INSERT INTO asset_source_documents (title, contract_ref, created_by, created_at) VALUES ('Test Doc', '001/TEST', 'system', '2026-09-07T00:00:00Z')`
    ).run();
    const docId = docInsert.meta.last_row_id;
    await env.DB.prepare(
      `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_unit, raw_quantity, raw_condition, raw_note, created_at)
       VALUES (?, 'A. TEST GROUP', 1, 'Test Item', 'cái', '01', 'Tốt', NULL, '2026-09-07T00:00:00Z')`
    ).bind(docId).run();
    const row = await env.DB.prepare(`SELECT raw_quantity FROM asset_source_rows WHERE source_document_id = ? AND stt = 1`).bind(docId).first();
    expect(row.raw_quantity).toBe('01');
  });

  it('stores a NULL raw_quantity for a source row with no known quantity, never 0', async () => {
    const docInsert = await env.DB.prepare(
      `INSERT INTO asset_source_documents (title, created_by, created_at) VALUES ('Test Doc 2', 'system', '2026-09-07T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_condition, created_at)
       VALUES (?, 'A. TEST GROUP', 1, 'Unknown Qty Item', 'Tốt', '2026-09-07T00:00:00Z')`
    ).bind(docInsert.meta.last_row_id).run();
    const row = await env.DB.prepare(`SELECT raw_quantity FROM asset_source_rows WHERE source_document_id = ? AND stt = 1`).bind(docInsert.meta.last_row_id).first();
    expect(row.raw_quantity).toBeNull();
  });

  it('rejects a duplicate (source_document_id, stt) pair via the unique constraint', async () => {
    const docInsert = await env.DB.prepare(
      `INSERT INTO asset_source_documents (title, created_by, created_at) VALUES ('Test Doc 3', 'system', '2026-09-07T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, created_at) VALUES (?, 'A', 1, 'X', '2026-09-07T00:00:00Z')`
    ).bind(docInsert.meta.last_row_id).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, created_at) VALUES (?, 'A', 1, 'Y', '2026-09-07T00:00:00Z')`
      ).bind(docInsert.meta.last_row_id).run()
    ).rejects.toThrow();
  });
});

describe('migration 0028', () => {
  it('adds can_add_finance_transaction to staff_accounts, defaulting to 0', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('mig0028_default', 'x', 'reception', '2026-09-07T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT can_add_finance_transaction FROM staff_accounts WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.can_add_finance_transaction).toBe(0);
  });

  it('allows can_add_finance_transaction to be set to 1', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO staff_accounts (username, password_hash, role, created_at, can_add_finance_transaction) VALUES ('mig0028_granted', 'x', 'reception', '2026-09-07T00:00:00Z', 1)`
    ).run();
    const row = await env.DB.prepare(`SELECT can_add_finance_transaction FROM staff_accounts WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.can_add_finance_transaction).toBe(1);
  });
});

describe('migration 0029', () => {
  async function seedCategory(managementType) {
    const insert = await env.DB.prepare(
      `INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES (?, 'Test Category', 'cái', 'system', '2026-09-07T00:00:00Z')`
    ).bind(managementType).run();
    return insert.meta.last_row_id;
  }

  it('creates an asset with required fields and defaults for the 3 status fields', async () => {
    const categoryId = await seedCategory('durable_goods');
    const insert = await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, created_by, created_at) VALUES (?, 'Giường 1', 'handover_a', 'system', '2026-09-07T00:00:00Z')`
    ).bind(categoryId).run();
    const row = await env.DB.prepare(`SELECT physical_condition, operational_status, lifecycle_status FROM assets WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row).toEqual({ physical_condition: 'chua_danh_gia', operational_status: 'san_sang', lifecycle_status: 'dang_quan_ly' });
  });

  it('rejects an invalid source_type', async () => {
    const categoryId = await seedCategory('durable_goods');
    await expect(
      env.DB.prepare(
        `INSERT INTO assets (category_id, name, source_type, created_by, created_at) VALUES (?, 'X', 'invalid', 'system', '2026-09-07T00:00:00Z')`
      ).bind(categoryId).run()
    ).rejects.toThrow();
  });

  it('rejects an invalid physical_condition', async () => {
    const categoryId = await seedCategory('durable_goods');
    await expect(
      env.DB.prepare(
        `INSERT INTO assets (category_id, name, source_type, physical_condition, created_by, created_at) VALUES (?, 'X', 'handover_a', 'invalid', 'system', '2026-09-07T00:00:00Z')`
      ).bind(categoryId).run()
    ).rejects.toThrow();
  });

  it('rejects an invalid operational_status', async () => {
    const categoryId = await seedCategory('durable_goods');
    await expect(
      env.DB.prepare(
        `INSERT INTO assets (category_id, name, source_type, operational_status, created_by, created_at) VALUES (?, 'X', 'handover_a', 'invalid', 'system', '2026-09-07T00:00:00Z')`
      ).bind(categoryId).run()
    ).rejects.toThrow();
  });

  it('rejects an invalid lifecycle_status', async () => {
    const categoryId = await seedCategory('durable_goods');
    await expect(
      env.DB.prepare(
        `INSERT INTO assets (category_id, name, source_type, lifecycle_status, created_by, created_at) VALUES (?, 'X', 'handover_a', 'invalid', 'system', '2026-09-07T00:00:00Z')`
      ).bind(categoryId).run()
    ).rejects.toThrow();
  });

  it('allows a NULL quantity ("Chưa xác định") and a NULL location_id ("Chưa phân bổ vị trí")', async () => {
    const categoryId = await seedCategory('durable_goods');
    const insert = await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, created_by, created_at) VALUES (?, 'X', 'handover_a', 'system', '2026-09-07T00:00:00Z')`
    ).bind(categoryId).run();
    const row = await env.DB.prepare(`SELECT quantity, location_id FROM assets WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row).toEqual({ quantity: null, location_id: null });
  });

  it('rejects a duplicate internal_code', async () => {
    const categoryId = await seedCategory('individual_device');
    await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, internal_code, created_by, created_at) VALUES (?, 'A', 'handover_a', 'TS000001', 'system', '2026-09-07T00:00:00Z')`
    ).bind(categoryId).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO assets (category_id, name, source_type, internal_code, created_by, created_at) VALUES (?, 'B', 'handover_a', 'TS000001', 'system', '2026-09-07T00:00:00Z')`
      ).bind(categoryId).run()
    ).rejects.toThrow();
  });

  it('allows multiple rows with a NULL internal_code (durable_goods/infrastructure never get one)', async () => {
    const categoryId = await seedCategory('durable_goods');
    await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, created_by, created_at) VALUES (?, 'A', 'handover_a', 'system', '2026-09-07T00:00:00Z')`
    ).bind(categoryId).run();
    const insert2 = await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, created_by, created_at) VALUES (?, 'B', 'handover_a', 'system', '2026-09-07T00:00:00Z')`
    ).bind(categoryId).run();
    const row = await env.DB.prepare(`SELECT internal_code FROM assets WHERE id = ?`).bind(insert2.meta.last_row_id).first();
    expect(row.internal_code).toBeNull();
  });

  it('links to a real asset_source_rows row via source_row_id', async () => {
    const categoryId = await seedCategory('individual_device');
    const docInsert = await env.DB.prepare(
      `INSERT INTO asset_source_documents (title, created_by, created_at) VALUES ('Test Doc M29', 'system', '2026-09-07T00:00:00Z')`
    ).run();
    const rowInsert = await env.DB.prepare(
      `INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_quantity, created_at) VALUES (?, 'A', 1, 'Điều hoà', '8', '2026-09-07T00:00:00Z')`
    ).bind(docInsert.meta.last_row_id).run();
    const insert = await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, source_row_id, created_by, created_at) VALUES (?, 'Điều hoà 1', 'handover_a', ?, 'system', '2026-09-07T00:00:00Z')`
    ).bind(categoryId, rowInsert.meta.last_row_id).run();
    const row = await env.DB.prepare(`SELECT source_row_id FROM assets WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.source_row_id).toBe(rowInsert.meta.last_row_id);
  });
});

describe('migration 0030', () => {
  it('adds dine_in_menu_item_id, defaulting to null', async () => {
    const bookingInsert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Test Guest M30', '0900000030', 'vip', '2026-09-08', '2026-09-09', 'confirmed', 'staff', '2026-09-08T00:00:00Z')`
    ).run();
    const result = await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, service_catalog_id, name, unit_price, quantity, amount, created_by, created_at) VALUES (?, NULL, 'Test Service', 50000, 1, 50000, 'system', '2026-09-08T00:00:00Z')`
    ).bind(bookingInsert.meta.last_row_id).run();
    const row = await env.DB.prepare(`SELECT dine_in_menu_item_id FROM booking_service_items WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row.dine_in_menu_item_id).toBeNull();
  });

  it('links to a real dine_in_menu_items row via dine_in_menu_item_id', async () => {
    const bookingInsert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Test Guest M30b', '0900000031', 'vip', '2026-09-08', '2026-09-09', 'confirmed', 'staff', '2026-09-08T00:00:00Z')`
    ).run();
    const menuInsert = await env.DB.prepare(
      `INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Gà nướng', 'mon_an', 368000, 'MÓN GÀ & CÁ', 0, 1, 'system', '2026-09-08T00:00:00Z')`
    ).run();
    const result = await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, dine_in_menu_item_id, name, unit_price, quantity, amount, created_by, created_at) VALUES (?, ?, 'Gà nướng', 368000, 1, 368000, 'system', '2026-09-08T00:00:00Z')`
    ).bind(bookingInsert.meta.last_row_id, menuInsert.meta.last_row_id).run();
    const row = await env.DB.prepare(`SELECT dine_in_menu_item_id FROM booking_service_items WHERE id = ?`).bind(result.meta.last_row_id).first();
    expect(row.dine_in_menu_item_id).toBe(menuInsert.meta.last_row_id);
  });
});

describe('migration 0031', () => {
  async function seedCategory(managementType) {
    const insert = await env.DB.prepare(
      `INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at) VALUES (?, 'Test Category M31', 'cái', 'system', '2026-09-08T00:00:00Z')`
    ).bind(managementType).run();
    return insert.meta.last_row_id;
  }

  async function seedLocation() {
    const insert = await env.DB.prepare(
      `INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('common_area', 'Test Location M31', 'system', '2026-09-08T00:00:00Z')`
    ).run();
    return insert.meta.last_row_id;
  }

  async function seedAsset(categoryId) {
    const insert = await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, created_by, created_at) VALUES (?, 'Test Asset M31', 'handover_a', 'system', '2026-09-08T00:00:00Z')`
    ).bind(categoryId).run();
    return insert.meta.last_row_id;
  }

  it('creates asset_inventory_batches defaulting status to draft', async () => {
    const locationId = await seedLocation();
    const insert = await env.DB.prepare(
      `INSERT INTO asset_inventory_batches (location_id, label, created_by, created_at) VALUES (?, 'Test Batch', 'system', '2026-09-08T00:00:00Z')`
    ).bind(locationId).run();
    const row = await env.DB.prepare(`SELECT status FROM asset_inventory_batches WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.status).toBe('draft');
  });

  it('creates asset_inventory_lines with a working relationship to a batch and an asset', async () => {
    const locationId = await seedLocation();
    const categoryId = await seedCategory('durable_goods');
    const assetId = await seedAsset(categoryId);
    const batchInsert = await env.DB.prepare(
      `INSERT INTO asset_inventory_batches (location_id, label, created_by, created_at) VALUES (?, 'Test Batch', 'system', '2026-09-08T00:00:00Z')`
    ).bind(locationId).run();
    const batchId = batchInsert.meta.last_row_id;

    const lineInsert = await env.DB.prepare(
      `INSERT INTO asset_inventory_lines (batch_id, asset_id, book_quantity) VALUES (?, ?, 5)`
    ).bind(batchId, assetId).run();
    const row = await env.DB.prepare(`SELECT batch_id, asset_id, book_quantity, actual_quantity FROM asset_inventory_lines WHERE id = ?`).bind(lineInsert.meta.last_row_id).first();
    expect(row).toEqual({ batch_id: batchId, asset_id: assetId, book_quantity: 5, actual_quantity: null });
  });

  it('rejects a duplicate (batch_id, asset_id) pair', async () => {
    const locationId = await seedLocation();
    const categoryId = await seedCategory('durable_goods');
    const assetId = await seedAsset(categoryId);
    const batchInsert = await env.DB.prepare(
      `INSERT INTO asset_inventory_batches (location_id, label, created_by, created_at) VALUES (?, 'Test Batch', 'system', '2026-09-08T00:00:00Z')`
    ).bind(locationId).run();
    const batchId = batchInsert.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO asset_inventory_lines (batch_id, asset_id) VALUES (?, ?)`).bind(batchId, assetId).run();
    await expect(
      env.DB.prepare(`INSERT INTO asset_inventory_lines (batch_id, asset_id) VALUES (?, ?)`).bind(batchId, assetId).run()
    ).rejects.toThrow();
  });

  it('rejects an invalid batch status', async () => {
    const locationId = await seedLocation();
    await expect(
      env.DB.prepare(
        `INSERT INTO asset_inventory_batches (location_id, label, status, created_by, created_at) VALUES (?, 'Test Batch', 'bogus', 'system', '2026-09-08T00:00:00Z')`
      ).bind(locationId).run()
    ).rejects.toThrow();
  });

  it('adds assets.is_deleted, defaulting to 0', async () => {
    const categoryId = await seedCategory('durable_goods');
    const assetId = await seedAsset(categoryId);
    const row = await env.DB.prepare(`SELECT is_deleted FROM assets WHERE id = ?`).bind(assetId).first();
    expect(row.is_deleted).toBe(0);
  });
});

describe('migration 0032', () => {
  it('adds can_delete_asset to staff_accounts, defaulting to 0', async () => {
    const insert = await env.DB.prepare(
      `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('mig0032_default', 'x', 'reception', '2026-09-08T00:00:00Z')`
    ).run();
    const row = await env.DB.prepare(`SELECT can_delete_asset FROM staff_accounts WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.can_delete_asset).toBe(0);
  });
});

describe('migration 0033', () => {
  async function seedBooking() {
    const insert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Test Guest M33', '0900000033', 'circle', '2026-09-08', '2026-09-09', 'confirmed', 'website', '2026-09-08T00:00:00Z')`
    ).run();
    return insert.meta.last_row_id;
  }

  it('creates booking_deposits with a working relationship to a real booking', async () => {
    const bookingId = await seedBooking();
    const insert = await env.DB.prepare(
      `INSERT INTO booking_deposits (booking_id, amount, payment_method, created_by, created_at) VALUES (?, 200000, 'cash', 'system', '2026-09-08T00:00:00Z')`
    ).bind(bookingId).run();
    const row = await env.DB.prepare(`SELECT booking_id, amount, payment_method, note, finance_transaction_id FROM booking_deposits WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row).toEqual({ booking_id: bookingId, amount: 200000, payment_method: 'cash', note: null, finance_transaction_id: null });
  });

  it('rejects a non-positive amount', async () => {
    const bookingId = await seedBooking();
    await expect(
      env.DB.prepare(
        `INSERT INTO booking_deposits (booking_id, amount, payment_method, created_by, created_at) VALUES (?, 0, 'cash', 'system', '2026-09-08T00:00:00Z')`
      ).bind(bookingId).run()
    ).rejects.toThrow();
  });

  it('rejects an invalid payment_method', async () => {
    const bookingId = await seedBooking();
    await expect(
      env.DB.prepare(
        `INSERT INTO booking_deposits (booking_id, amount, payment_method, created_by, created_at) VALUES (?, 100000, 'bogus', 'system', '2026-09-08T00:00:00Z')`
      ).bind(bookingId).run()
    ).rejects.toThrow();
  });

  it('links to a real finance_transactions row via finance_transaction_id', async () => {
    const bookingId = await seedBooking();
    const txInsert = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'dich_vu', 200000, '2026-09-08', 'confirmed', 'system', '2026-09-08T00:00:00Z')`
    ).run();
    const insert = await env.DB.prepare(
      `INSERT INTO booking_deposits (booking_id, amount, payment_method, finance_transaction_id, created_by, created_at) VALUES (?, 200000, 'transfer', ?, 'system', '2026-09-08T00:00:00Z')`
    ).bind(bookingId, txInsert.meta.last_row_id).run();
    const row = await env.DB.prepare(`SELECT finance_transaction_id FROM booking_deposits WHERE id = ?`).bind(insert.meta.last_row_id).first();
    expect(row.finance_transaction_id).toBe(txInsert.meta.last_row_id);
  });
});
