import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listCustomers } from '../functions/api/customers/index.js';
import { createSession } from '../lib/auth.js';

let managerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM feedback_responses');

  await env.DB.prepare(`INSERT INTO staff_accounts (id, username, password_hash, role, created_at) VALUES (1, 'quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, 1);

  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, wants_telegram, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-1', '2026-08-20T10:00:00Z', 'Nguyễn Văn A', '0900000001', 'a@example.com', 0, NULL, 5, 1, 'HLG-AAAA', 10, '2099-01-01T00:00:00Z', 'unused', 0, 0)`
  ).run();
  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, wants_telegram, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-2', '2026-08-19T10:00:00Z', 'Trần Thị B', '0900000002', NULL, 1, '999', 4, 1, 'HLG-BBBB', 10, '2020-01-01T00:00:00Z', 'unused', 0, 0)`
  ).run();
  await env.DB.prepare(
    `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, wants_telegram, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
     VALUES ('fb-3', '2026-08-18T10:00:00Z', 'Lê Văn C', '0900000003', 'c@example.com', 0, NULL, 3, 1, 'HLG-CCCC', 10, '2099-01-01T00:00:00Z', 'used', 0, 0)`
  ).run();
});

function authedRequest(url, method = 'GET') {
  return new Request(url, { method, headers: { Cookie: `session=${managerToken}` } });
}

describe('GET /api/customers', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listCustomers({ request: new Request('https://x/api/customers'), env });
    expect(response.status).toBe(401);
  });

  it('lists all customers newest first with computed status', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-1', 'fb-2', 'fb-3']);
    expect(body.results[0]).toMatchObject({ promoStatus: 'unused', hasTelegramChatId: false });
    expect(body.results[1]).toMatchObject({ promoStatus: 'expired', hasTelegramChatId: true });
    expect(body.results[2]).toMatchObject({ promoStatus: 'used' });
  });

  it('filters by status', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?status=expired'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-2']);
  });

  it('searches by guest name', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?search=Tr%E1%BA%A7n'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-2']);
  });

  it('searches by phone', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?search=0900000003'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-3']);
  });

  it('searches by promo code', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?search=HLG-AAAA'), env });
    const body = await response.json();
    expect(body.results.map((r) => r.feedbackId)).toEqual(['fb-1']);
  });

  it('paginates', async () => {
    const response = await listCustomers({ request: authedRequest('https://x/api/customers?page=1&pageSize=2'), env });
    const body = await response.json();
    expect(body.results).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
  });
});
