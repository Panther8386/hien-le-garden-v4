import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listOrders, onRequestPost as createOrder } from '../functions/api/dine-in-orders/index.js';
import { onRequestGet as getOrder } from '../functions/api/dine-in-orders/[id]/index.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM dine_in_orders');
  await env.DB.exec('DELETE FROM dine_in_order_items');
  await env.DB.exec('DELETE FROM dine_in_menu_items');
  await env.DB.exec('DELETE FROM audit_log');
  await env.DB.exec(`DELETE FROM finance_transactions WHERE category = 'khach_vang_lai'`);

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_order', 'x', 'manager', '2026-09-04T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_order', 'x', 'reception', '2026-09-04T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_order', 'x', 'admin', '2026-09-04T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_order', 'x', 'observer', '2026-09-04T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('POST /api/dine-in-orders', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await createOrder({ request: new Request('https://x/api/dine-in-orders', { method: 'POST' }), env });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await createOrder({ request: authedRequest('https://x/api/dine-in-orders', observerToken, 'POST', { tableLabel: 'Bàn 1' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects a missing tableLabel (400)', async () => {
    const response = await createOrder({ request: authedRequest('https://x/api/dine-in-orders', receptionToken, 'POST', {}), env });
    expect(response.status).toBe(400);
  });

  it('opens a table with status=open', async () => {
    const response = await createOrder({ request: authedRequest('https://x/api/dine-in-orders', receptionToken, 'POST', { tableLabel: 'Bàn 3', note: 'gần cửa' }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT table_label, note, status, opened_by FROM dine_in_orders WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ table_label: 'Bàn 3', note: 'gần cửa', status: 'open', opened_by: 'le_tan_order' });
  });
});

describe('GET /api/dine-in-orders', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listOrders({ request: new Request('https://x/api/dine-in-orders'), env });
    expect(response.status).toBe(401);
  });

  it('defaults to status=open and computes currentTotal from posted items only', async () => {
    const order = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn 5', 'open', 'le_tan_order', '2026-09-04T08:00:00Z')`).run();
    const orderId = order.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO dine_in_order_items (order_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Mì Quảng', 45000, 1, 45000, 'posted', 'le_tan_order', '2026-09-04T08:05:00Z')`).bind(orderId).run();
    await env.DB.prepare(`INSERT INTO dine_in_order_items (order_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Cà phê', 25000, 1, 25000, 'voided', 'le_tan_order', '2026-09-04T08:06:00Z')`).bind(orderId).run();

    const response = await listOrders({ request: authedRequest('https://x/api/dine-in-orders', observerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toEqual([{ id: orderId, tableLabel: 'Bàn 5', note: null, status: 'open', openedBy: 'le_tan_order', openedAt: '2026-09-04T08:00:00Z', currentTotal: 45000 }]);
  });

  it('rejects an invalid status query param (400)', async () => {
    const response = await listOrders({ request: authedRequest('https://x/api/dine-in-orders?status=deleted', receptionToken, 'GET'), env });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/dine-in-orders/:id', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getOrder({ request: new Request('https://x/api/dine-in-orders/1'), env, params: { id: '1' } });
    expect(response.status).toBe(401);
  });

  it('404s for a non-existent id', async () => {
    const response = await getOrder({ request: authedRequest('https://x/api/dine-in-orders/999999', receptionToken, 'GET'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('returns order detail including its items', async () => {
    const order = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn 7', 'open', 'le_tan_order', '2026-09-04T08:00:00Z')`).run();
    const orderId = order.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO dine_in_order_items (order_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Mì Quảng', 45000, 1, 45000, 'posted', 'le_tan_order', '2026-09-04T08:05:00Z')`).bind(orderId).run();

    const response = await getOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}`, observerToken, 'GET'), env, params: { id: String(orderId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tableLabel).toBe('Bàn 7');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ name: 'Mì Quảng', unitPrice: 45000, quantity: 1, amount: 45000, status: 'posted' });
  });
});
