import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listOrders, onRequestPost as createOrder } from '../functions/api/dine-in-orders/index.js';
import { onRequestGet as getOrder } from '../functions/api/dine-in-orders/[id]/index.js';
import { onRequestPost as addItem } from '../functions/api/dine-in-orders/[id]/items/index.js';
import { onRequestPatch as voidItem } from '../functions/api/dine-in-orders/[id]/items/[itemId].js';
import { onRequestPost as voidOrder } from '../functions/api/dine-in-orders/[id]/void.js';
import { onRequestPost as closeOrder } from '../functions/api/dine-in-orders/[id]/close.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM dine_in_order_items');
  await env.DB.exec('DELETE FROM dine_in_orders');
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

describe('POST /api/dine-in-orders/:id/items', () => {
  let orderId, menuItemId;
  beforeEach(async () => {
    const order = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn 2', 'open', 'le_tan_order', '2026-09-04T08:00:00Z')`).run();
    orderId = order.meta.last_row_id;
    const menu = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Mì Quảng', 'mon_an', 45000, 0, 1, 'admin_order', '2026-09-04T00:00:00Z')`).run();
    menuItemId = menu.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await addItem({ request: new Request(`https://x/api/dine-in-orders/${orderId}/items`, { method: 'POST' }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await addItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items`, observerToken, 'POST', { menuItemId, quantity: 1 }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent order', async () => {
    const response = await addItem({ request: authedRequest('https://x/api/dine-in-orders/999999/items', receptionToken, 'POST', { menuItemId, quantity: 1 }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an inactive menu item (400)', async () => {
    const inactive = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, display_order, is_active, updated_by, updated_at) VALUES ('Ngừng bán', 'mon_an', 30000, 0, 0, 'admin_order', '2026-09-04T00:00:00Z')`).run();
    const response = await addItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items`, receptionToken, 'POST', { menuItemId: inactive.meta.last_row_id, quantity: 1 }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(400);
  });

  it('snapshots name/price and computes amount = unitPrice * quantity', async () => {
    const response = await addItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items`, receptionToken, 'POST', { menuItemId, quantity: 3 }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(201);
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT name, unit_price, quantity, amount, status FROM dine_in_order_items WHERE id = ?`).bind(body.id).first();
    expect(row).toEqual({ name: 'Mì Quảng', unit_price: 45000, quantity: 3, amount: 135000, status: 'posted' });
  });

  it('rejects adding items when the order is not open', async () => {
    await env.DB.prepare(`UPDATE dine_in_orders SET status = 'closed' WHERE id = ?`).bind(orderId).run();
    const response = await addItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items`, receptionToken, 'POST', { menuItemId, quantity: 1 }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/dine-in-orders/:id/items/:itemId', () => {
  let orderId, itemId;
  beforeEach(async () => {
    const order = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn 4', 'open', 'le_tan_order', '2026-09-04T08:00:00Z')`).run();
    orderId = order.meta.last_row_id;
    const item = await env.DB.prepare(`INSERT INTO dine_in_order_items (order_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Mì Quảng', 45000, 1, 45000, 'posted', 'le_tan_order', '2026-09-04T08:05:00Z')`).bind(orderId).run();
    itemId = item.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await voidItem({ request: new Request(`https://x/api/dine-in-orders/${orderId}/items/${itemId}`, { method: 'PATCH' }), env, params: { id: String(orderId), itemId: String(itemId) } });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await voidItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items/${itemId}`, observerToken, 'PATCH'), env, params: { id: String(orderId), itemId: String(itemId) } });
    expect(response.status).toBe(403);
  });

  it('404s when the item does not belong to this order', async () => {
    const otherOrder = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn khác', 'open', 'le_tan_order', '2026-09-04T08:00:00Z')`).run();
    const response = await voidItem({ request: authedRequest(`https://x/api/dine-in-orders/${otherOrder.meta.last_row_id}/items/${itemId}`, receptionToken, 'PATCH'), env, params: { id: String(otherOrder.meta.last_row_id), itemId: String(itemId) } });
    expect(response.status).toBe(404);
  });

  it('voids the item and writes a service_void audit_log row', async () => {
    const response = await voidItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items/${itemId}`, receptionToken, 'PATCH'), env, params: { id: String(orderId), itemId: String(itemId) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status, voided_by FROM dine_in_order_items WHERE id = ?`).bind(itemId).first();
    expect(row).toEqual({ status: 'voided', voided_by: 'le_tan_order' });

    const auditRow = await env.DB.prepare(`SELECT action_type, entity_type, actor FROM audit_log WHERE entity_type = 'dine_in_order_item' AND entity_id = ?`).bind(itemId).first();
    expect(auditRow).toEqual({ action_type: 'service_void', entity_type: 'dine_in_order_item', actor: 'le_tan_order' });
  });

  it('rejects voiding an already-voided item (400)', async () => {
    await voidItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items/${itemId}`, receptionToken, 'PATCH'), env, params: { id: String(orderId), itemId: String(itemId) } });
    const response = await voidItem({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/items/${itemId}`, receptionToken, 'PATCH'), env, params: { id: String(orderId), itemId: String(itemId) } });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/dine-in-orders/:id/void', () => {
  let orderId;
  beforeEach(async () => {
    const order = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn 8', 'open', 'le_tan_order', '2026-09-04T08:00:00Z')`).run();
    orderId = order.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await voidOrder({ request: new Request(`https://x/api/dine-in-orders/${orderId}/void`, { method: 'POST' }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await voidOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/void`, observerToken, 'POST'), env, params: { id: String(orderId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent order', async () => {
    const response = await voidOrder({ request: authedRequest('https://x/api/dine-in-orders/999999/void', receptionToken, 'POST'), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('voids the order without creating a finance_transactions row, writing a dine_in_order_void audit_log row', async () => {
    const response = await voidOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/void`, receptionToken, 'POST'), env, params: { id: String(orderId) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT status FROM dine_in_orders WHERE id = ?`).bind(orderId).first();
    expect(row.status).toBe('voided');

    const txCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions WHERE category = 'khach_vang_lai'`).first();
    expect(txCount.n).toBe(0);

    const auditRow = await env.DB.prepare(`SELECT action_type, actor FROM audit_log WHERE entity_type = 'dine_in_order' AND entity_id = ?`).bind(orderId).first();
    expect(auditRow).toEqual({ action_type: 'dine_in_order_void', actor: 'le_tan_order' });
  });

  it('rejects voiding an order that is not open (400)', async () => {
    await env.DB.prepare(`UPDATE dine_in_orders SET status = 'closed' WHERE id = ?`).bind(orderId).run();
    const response = await voidOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/void`, receptionToken, 'POST'), env, params: { id: String(orderId) } });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/dine-in-orders/:id/close', () => {
  let orderId;
  beforeEach(async () => {
    const order = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn 9', 'open', 'le_tan_order', '2026-09-04T08:00:00Z')`).run();
    orderId = order.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO dine_in_order_items (order_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Mì Quảng', 45000, 2, 90000, 'posted', 'le_tan_order', '2026-09-04T08:05:00Z')`).bind(orderId).run();
    await env.DB.prepare(`INSERT INTO dine_in_order_items (order_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Cà phê', 25000, 1, 25000, 'voided', 'le_tan_order', '2026-09-04T08:06:00Z')`).bind(orderId).run();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await closeOrder({ request: new Request(`https://x/api/dine-in-orders/${orderId}/close`, { method: 'POST' }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(401);
  });

  it('rejects observer (403)', async () => {
    const response = await closeOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/close`, observerToken, 'POST', { paymentMethod: 'cash' }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent order', async () => {
    const response = await closeOrder({ request: authedRequest('https://x/api/dine-in-orders/999999/close', receptionToken, 'POST', { paymentMethod: 'cash' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects a missing/invalid paymentMethod (400)', async () => {
    const response = await closeOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/close`, receptionToken, 'POST', {}), env, params: { id: String(orderId) } });
    expect(response.status).toBe(400);
  });

  it('closes the order, computing total from posted items only, and creates exactly one finance_transactions row', async () => {
    const response = await closeOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/close`, receptionToken, 'POST', { paymentMethod: 'transfer' }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalAmount).toBe(90000);

    const orderRow = await env.DB.prepare(`SELECT status, closed_by, payment_method, total_amount, finance_transaction_id FROM dine_in_orders WHERE id = ?`).bind(orderId).first();
    expect(orderRow).toEqual({ status: 'closed', closed_by: 'le_tan_order', payment_method: 'transfer', total_amount: 90000, finance_transaction_id: body.financeTransactionId });

    const txRows = await env.DB.prepare(`SELECT type, category, amount, status FROM finance_transactions WHERE id = ?`).bind(body.financeTransactionId).first();
    expect(txRows).toEqual({ type: 'income', category: 'khach_vang_lai', amount: 90000, status: 'confirmed' });

    const txCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions WHERE category = 'khach_vang_lai'`).first();
    expect(txCount.n).toBe(1);
  });

  it('rejects closing an order with zero posted items (400)', async () => {
    await env.DB.exec(`DELETE FROM dine_in_order_items WHERE order_id = ${orderId}`);
    const response = await closeOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/close`, receptionToken, 'POST', { paymentMethod: 'cash' }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(400);
  });

  it('rejects closing an order that is not open (400)', async () => {
    await env.DB.prepare(`UPDATE dine_in_orders SET status = 'voided' WHERE id = ?`).bind(orderId).run();
    const response = await closeOrder({ request: authedRequest(`https://x/api/dine-in-orders/${orderId}/close`, receptionToken, 'POST', { paymentMethod: 'cash' }), env, params: { id: String(orderId) } });
    expect(response.status).toBe(400);
  });
});
