import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('booking_service_items schema', () => {
  it('creates a posted row with the expected columns', async () => {
    await env.DB.exec('DELETE FROM bookings');
    const booking = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Schema Test', '0900000000', 'triangle', '2026-09-01', '2026-09-02', 'confirmed', 'website', '2026-08-28T00:00:00Z')`
    ).run();
    const bookingId = booking.meta.last_row_id;

    await env.DB.prepare(
      `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Cà phê', 30000, 2, 60000, 'posted', 'le_tan_a', '2026-08-28T00:00:00Z')`
    ).bind(bookingId).run();

    const row = await env.DB.prepare(`SELECT * FROM booking_service_items WHERE booking_id = ?`).bind(bookingId).first();
    expect(row.name).toBe('Cà phê');
    expect(row.unit_price).toBe(30000);
    expect(row.quantity).toBe(2);
    expect(row.amount).toBe(60000);
    expect(row.status).toBe('posted');
    expect(row.voided_by).toBeNull();
  });

  it('rejects an invalid status value', async () => {
    await env.DB.exec('DELETE FROM bookings');
    const booking = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, room_type, check_in, check_out, status, source, created_at) VALUES ('Schema Test 2', '0900000000', 'triangle', '2026-09-01', '2026-09-02', 'confirmed', 'website', '2026-08-28T00:00:00Z')`
    ).run();
    const bookingId = booking.meta.last_row_id;

    await expect(
      env.DB.prepare(
        `INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_at) VALUES (?, 'Bad', 1000, 1, 1000, 'bogus', '2026-08-28T00:00:00Z')`
      ).bind(bookingId).run()
    ).rejects.toThrow();
  });
});
