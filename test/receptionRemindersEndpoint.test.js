import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getReminders } from '../functions/api/reception/reminders.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM bookings');
  await env.DB.exec('UPDATE rooms SET needs_cleaning = 0, needs_cleaning_since = NULL');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_re', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (2, 'le_tan_re', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  receptionToken = await createSession(env.DB, 2);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (3, 'admin_re', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, 3);
  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (4, 'quan_sat_re', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  observerToken = await createSession(env.DB, 4);
});

function authedRequest(url, token) {
  return new Request(url, { headers: token ? { Cookie: `session=${token}` } : {} });
}

describe('GET /api/reception/reminders', () => {
  it('returns the reminders shape', async () => {
    const response = await getReminders({ request: authedRequest('https://x/api/reception/reminders', managerToken), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('pendingNoDeposit');
    expect(body).toHaveProperty('arrivingToday');
    expect(body).toHaveProperty('roomsNotCleaned');
    expect(body).toHaveProperty('thresholds');
  });

  it('lets reception, manager, admin, and observer all view it', async () => {
    for (const token of [receptionToken, managerToken, adminToken, observerToken]) {
      const response = await getReminders({ request: authedRequest('https://x/api/reception/reminders', token), env });
      expect(response.status).toBe(200);
    }
  });

  it('rejects unauthenticated requests', async () => {
    const response = await getReminders({ request: new Request('https://x/api/reception/reminders'), env });
    expect(response.status).toBe(401);
  });
});

describe('GET /api/reception/reminders — guest contact redaction', () => {
  async function seedBookings() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, email, room_type, check_in, check_out, status, source, created_at, deposit_amount)
       VALUES ('Khách Chờ Cọc', '0911111111', 'cho@example.com', 'circle', '2099-01-01', '2099-01-02', 'pending', 'phone', '2020-01-01T00:00:00Z', 0)`
    ).run();
    await env.DB.prepare(
      `INSERT INTO bookings (guest_name, phone, email, room_type, check_in, check_out, status, source, created_at)
       VALUES ('Khách Đến Hôm Nay', '0922222222', 'den@example.com', 'circle', ?, '2099-12-31', 'confirmed', 'phone', '2020-01-01T00:00:00Z')`
    ).bind(today).run();
  }

  it('nulls guest phone in both lists for an observer (no guests.contact_view)', async () => {
    await seedBookings();
    const body = await (await getReminders({ request: authedRequest('https://x/api/reception/reminders', observerToken), env })).json();
    expect(body.pendingNoDeposit).toHaveLength(1);
    expect(body.arrivingToday).toHaveLength(1);
    expect(body.pendingNoDeposit[0].phone).toBeNull();
    expect(body.arrivingToday[0].phone).toBeNull();
    expect(body.pendingNoDeposit[0].guestName).toBe('Khách Chờ Cọc');
  });

  it('keeps guest phone for reception (has guests.contact_view)', async () => {
    await seedBookings();
    const body = await (await getReminders({ request: authedRequest('https://x/api/reception/reminders', receptionToken), env })).json();
    expect(body.pendingNoDeposit[0].phone).toBe('0911111111');
    expect(body.arrivingToday[0].phone).toBe('0922222222');
  });
});
