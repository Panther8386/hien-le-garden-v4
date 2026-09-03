import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('service_catalog seed data', () => {
  it('has exactly 20 rows across the three categories', async () => {
    const { results } = await env.DB.prepare(`SELECT category, COUNT(*) AS n FROM service_catalog GROUP BY category`).all();
    const counts = Object.fromEntries(results.map((r) => [r.category, r.n]));
    expect(counts.luu_tru).toBe(9);
    expect(counts.fnb_hoat_dong).toBe(8);
    expect(counts.su_kien_team_building).toBe(3);
  });

  it('links exactly six luu_tru rows to a room_type_key, one per key', async () => {
    const { results } = await env.DB.prepare(`SELECT room_type_key FROM service_catalog WHERE room_type_key IS NOT NULL ORDER BY room_type_key`).all();
    expect(results.map((r) => r.room_type_key)).toEqual(['bungalow', 'circle', 'dormitory', 'ede_cozy', 'triangle', 'vip']);
  });

  it('has two label-type rows with the expected non-numeric labels', async () => {
    const { results } = await env.DB.prepare(`SELECT name, price_label FROM service_catalog WHERE price_type = 'label' ORDER BY id`).all();
    expect(results).toEqual([
      { name: 'Khu vui chơi trẻ em', price_label: 'Miễn phí' },
      { name: 'Bán nông sản & sản phẩm', price_label: 'Theo giá thị trường' },
    ]);
  });

  it('splits luu_tru into the two expected subgroups', async () => {
    const { results } = await env.DB.prepare(`SELECT subgroup, COUNT(*) AS n FROM service_catalog WHERE category = 'luu_tru' GROUP BY subgroup`).all();
    const counts = Object.fromEntries(results.map((r) => [r.subgroup, r.n]));
    expect(counts['Lưu Trú Theo Đêm']).toBe(6);
    expect(counts['Giờ Xanh Hiền Lê']).toBe(3);
  });
});

describe('cancellation_policy_tier seed data', () => {
  it('starts empty', async () => {
    const { results } = await env.DB.prepare(`SELECT * FROM cancellation_policy_tier`).all();
    expect(results).toEqual([]);
  });
});

describe('bookings.refund_percent_applied column', () => {
  it('exists and defaults to NULL on a new row', async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Schema Test Guest', '0900000001', 'triangle', '2026-09-01', '2026-09-02', 'pending', 'website', ?)`
    ).bind(now).run();
    const row = await env.DB.prepare(`SELECT refund_percent_applied FROM bookings WHERE guest_name = 'Schema Test Guest'`).first();
    expect(row.refund_percent_applied).toBeNull();
  });
});
