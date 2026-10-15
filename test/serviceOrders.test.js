import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { setOverride } from './helpers/permissions.js';
import { envWithHookBefore } from './helpers/raceEnv.js';
import * as ordersIndex from '../functions/api/service-orders/index.js';
import * as ordersCategories from '../functions/api/service-orders/categories.js';
import * as orderById from '../functions/api/service-orders/[id].js';

let adminToken, managerToken, receptionToken, observerToken;
let receptionId;

beforeEach(async () => {
  // D1 enforces foreign keys: children before parents.
  for (const t of ['audit_log', 'service_order_deposits', 'service_order_items', 'booking_deposits', 'finance_transactions',
    'service_orders', 'bookings', 'user_permission_overrides', 'sessions', 'staff_accounts']) {
    await env.DB.exec(`DELETE FROM ${t}`);
  }
  const staff = async (u, role) => {
    const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES (?, 'x', ?, '2026-08-01T00:00:00Z')`).bind(u, role).run();
    return r.meta.last_row_id;
  };
  adminToken = await createSession(env.DB, await staff('qt_so', 'admin'));
  managerToken = await createSession(env.DB, await staff('ql_so', 'manager'));
  receptionId = await staff('lt_so', 'reception');
  receptionToken = await createSession(env.DB, receptionId);
  observerToken = await createSession(env.DB, await staff('qs_so', 'observer'));
});

export function call(handler, { method = 'GET', url = 'https://x/api/service-orders', token, body, params = {}, testEnv = env }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return handler({ request: new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined }), env: testEnv, params });
}

const ORDER = {
  orderType: 'dat_tiec', customerName: 'Chị Lan', phone: '0900000000', organization: 'Công ty A', note: null,
  eventDate: '2026-12-20', eventTime: '18:30', guestCount: 50, venueNote: 'Sân vườn', bookingId: null,
  primaryCategory: 'bep_hien_le',
  items: [
    { description: 'Set menu 8 món', quantity: 5, unitPrice: 2000000, financeCategory: 'bep_hien_le' },
    { description: 'Nước uống', quantity: 1, unitPrice: 1000000, financeCategory: 'hien_le_drinks' },
  ],
};

export async function createOrder(overrides = {}, token = managerToken) {
  const response = await call(ordersIndex.onRequestPost, { method: 'POST', token, body: { ...ORDER, ...overrides } });
  expect(response.status).toBe(201);
  return (await response.json()).id;
}

describe('POST /api/service-orders', () => {
  it('creates a draft with items, settings defaults and one creation audit without the phone', async () => {
    const id = await createOrder();
    const row = await env.DB.prepare('SELECT * FROM service_orders WHERE id = ?').bind(id).first();
    expect(row).toMatchObject({ status: 'draft', deposit_amount: 0, quote_valid_days: 7, requested_deposit: 3300000, created_by: 'ql_so' });
    const items = (await env.DB.prepare('SELECT description, display_order FROM service_order_items WHERE order_id = ? ORDER BY display_order').bind(id).all()).results;
    expect(items.map((i) => i.description)).toEqual(['Set menu 8 món', 'Nước uống']);
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'service_order_create'`).first();
    expect(audit).toMatchObject({ entity_type: 'service_order', entity_id: id, entity_label: `Đơn #${id}`, actor: 'ql_so' });
    expect(audit.new_value).not.toContain('0900000000');
  });

  it('lets reception create but not observer (403)', async () => {
    await createOrder({}, receptionToken);
    const denied = await call(ordersIndex.onRequestPost, { method: 'POST', token: observerToken, body: ORDER });
    expect(denied.status).toBe(403);
  });

  it('rejects an expense primary line, a bad item and an unknown booking', async () => {
    for (const body of [{ ...ORDER, primaryCategory: 'vat_tu' }, { ...ORDER, items: [{ ...ORDER.items[0], quantity: 0 }] }, { ...ORDER, bookingId: 999999 }]) {
      const response = await call(ordersIndex.onRequestPost, { method: 'POST', token: managerToken, body });
      expect(response.status).toBe(400);
    }
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM service_orders').first()).n).toBe(0);
  });

  it('rejects a body above 64 KiB with 413', async () => {
    const response = await call(ordersIndex.onRequestPost, { method: 'POST', token: managerToken, body: { ...ORDER, note: 'x'.repeat(70000) } });
    expect(response.status).toBe(413);
  });
});

describe('GET /api/service-orders and /:id', () => {
  it('lists open orders by event date and hides phone without guests.contact_view', async () => {
    const late = await createOrder({ eventDate: '2026-12-30' });
    const early = await createOrder({ eventDate: '2026-12-01' });
    const response = await call(ordersIndex.onRequestGet, { url: 'https://x/api/service-orders?status=open', token: observerToken });
    const rows = await response.json();
    expect(rows.map((r) => r.id)).toEqual([early, late]);
    expect(rows[0]).toMatchObject({ total: 11000000, quoteNumber: expect.stringMatching(/^BG-\d{4}-\d{4}$/), phone: null });
  });

  it('returns the detail with items, deposits, totals per line and 404 for a hidden order without records.hide', async () => {
    const id = await createOrder();
    const detail = await (await call(orderById.onRequestGet, { url: `https://x/api/service-orders/${id}`, token: receptionToken, params: { id: String(id) } })).json();
    expect(detail.categoryTotals).toEqual({ bep_hien_le: 10000000, hien_le_drinks: 1000000 });
    expect(detail.phone).toBe('0900000000');
    await env.DB.prepare('UPDATE service_orders SET is_hidden = 1 WHERE id = ?').bind(id).run();
    const hidden = await call(orderById.onRequestGet, { url: `https://x/api/service-orders/${id}`, token: receptionToken, params: { id: String(id) } });
    expect(hidden.status).toBe(404);
  });

  it('serves income categories to reception', async () => {
    const rows = await (await call(ordersCategories.onRequestGet, { url: 'https://x/api/service-orders/categories', token: receptionToken })).json();
    expect(rows.find((c) => c.slug === 'bep_hien_le')).toMatchObject({ label: expect.any(String), isActive: true });
    expect(rows.some((c) => c.slug === 'vat_tu')).toBe(false);
  });
});
