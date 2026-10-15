import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { setOverride } from './helpers/permissions.js';
import { envWithHookBefore } from './helpers/raceEnv.js';
import * as ordersIndex from '../functions/api/service-orders/index.js';
import * as ordersCategories from '../functions/api/service-orders/categories.js';
import * as orderById from '../functions/api/service-orders/[id].js';
import * as confirmOrder from '../functions/api/service-orders/[id]/confirm.js';
import * as orderDeposits from '../functions/api/service-orders/[id]/deposits/index.js';
import * as orderDeposit from '../functions/api/service-orders/[id]/deposits/[depositId].js';
import * as settleOrder from '../functions/api/service-orders/[id]/settle.js';
import * as cancelOrder from '../functions/api/service-orders/[id]/cancel.js';
import * as hideOrder from '../functions/api/service-orders/[id]/hide.js';
import * as quoteSettings from '../functions/api/quote-settings.js';

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

async function detail(id, token = managerToken) {
  return (await call(orderById.onRequestGet, { url: `https://x/api/service-orders/${id}`, token, params: { id: String(id) } })).json();
}
function patch(id, body, token = managerToken, testEnv = env) {
  return call(orderById.onRequestPatch, { method: 'PATCH', url: `https://x/api/service-orders/${id}`, token, body, params: { id: String(id) }, testEnv });
}
function bodyFrom(d, changes = {}) {
  return {
    orderType: d.orderType, customerName: d.customerName, phone: d.phone, organization: d.organization, note: d.note,
    eventDate: d.eventDate, eventTime: d.eventTime, guestCount: d.guestCount, venueNote: d.venueNote, bookingId: d.bookingId,
    primaryCategory: d.primaryCategory, quoteValidDays: d.quoteValidDays, requestedDeposit: d.requestedDeposit, version: d.version,
    items: d.items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, financeCategory: i.financeCategory })),
    ...changes,
  };
}

describe('PATCH /api/service-orders/:id', () => {
  it('updates header and items (keep, change, remove, add) and writes one update audit', async () => {
    const id = await createOrder();
    const d = await detail(id);
    const items = [{ ...bodyFrom(d).items[0], quantity: 6 }, { description: 'Thuê âm thanh', quantity: 1, unitPrice: 3000000, financeCategory: 'ban_hang' }];
    expect((await patch(id, bodyFrom(d, { customerName: 'Anh Minh', items }))).status).toBe(200);
    const after = await detail(id);
    expect(after.customerName).toBe('Anh Minh');
    expect(after.items.map((i) => [i.description, i.quantity])).toEqual([['Set menu 8 món', 6], ['Thuê âm thanh', 1]]);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_order_update'`).first()).n).toBe(1);
  });

  it('stale snapshot returns 409 and writes nothing', async () => {
    const id = await createOrder();
    const d = await detail(id);
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => {
      await env.DB.prepare('UPDATE service_order_items SET quantity = 9 WHERE order_id = ?').bind(id).run();
    });
    const response = await patch(id, bodyFrom(d, { customerName: 'Muộn' }), managerToken, raced);
    expect(response.status).toBe(409);
    expect((await detail(id)).customerName).toBe('Chị Lan');
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_order_update'`).first()).n).toBe(0);
  });

  it('an edit saved from an outdated form returns 409 and keeps the other edit', async () => {
    const id = await createOrder();
    const d = await detail(id);
    const extra = { description: 'Thuê âm thanh', quantity: 1, unitPrice: 3000000, financeCategory: 'ban_hang' };
    expect((await patch(id, bodyFrom(d, { customerName: 'B', items: [...bodyFrom(d).items, extra] }))).status).toBe(200);
    expect((await patch(id, bodyFrom(d, { items: [bodyFrom(d).items[0]] }))).status).toBe(409);
    const after = await detail(id);
    expect(after.items).toHaveLength(3);
    expect(after.customerName).toBe('B');
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_order_update'`).first()).n).toBe(1);
  });

  it('requires the version token', async () => {
    const id = await createOrder();
    const d = await detail(id);
    const { version, ...rest } = bodyFrom(d);
    expect((await patch(id, rest)).status).toBe(400);
  });

  it('exposes a version that changes after a successful update', async () => {
    const id = await createOrder();
    const d = await detail(id);
    expect(typeof d.version).toBe('string');
    expect((await patch(id, bodyFrom(d, { note: 'Mới' }))).status).toBe(200);
    expect((await detail(id)).version).not.toBe(d.version);
  });

  it('refuses edits that would push the primary line below the deposit', async () => {
    const id = await createOrder();
    await env.DB.prepare('UPDATE service_orders SET deposit_amount = 5000000 WHERE id = ?').bind(id).run();
    const d = await detail(id);
    const moved = bodyFrom(d).items.map((i) => ({ ...i, financeCategory: 'hien_le_drinks' }));
    expect((await patch(id, bodyFrom(d, { items: moved }))).status).toBe(400);
    expect((await patch(id, bodyFrom(d, { primaryCategory: 'hien_le_drinks' }))).status).toBe(400);
  });

  it('keeps the stored phone when the editor cannot see contacts', async () => {
    const id = await createOrder();
    await setOverride(env.DB, receptionId, 'guests.contact_view', 'deny');
    const d = await detail(id, receptionToken);
    expect(d.phone).toBeNull();
    expect((await patch(id, bodyFrom(d, { note: 'Đổi ghi chú' }), receptionToken)).status).toBe(200);
    expect((await env.DB.prepare('SELECT phone FROM service_orders WHERE id = ?').bind(id).first()).phone).toBe('0900000000');
  });

  it('rejects edits on settled or cancelled orders and from observers', async () => {
    const id = await createOrder();
    const d = await detail(id);
    expect((await patch(id, bodyFrom(d), observerToken)).status).toBe(403);
    await env.DB.prepare(`UPDATE service_orders SET status = 'cancelled' WHERE id = ?`).bind(id).run();
    expect((await patch(id, bodyFrom(d))).status).toBe(400);
  });
});

describe('POST /api/service-orders/:id/confirm', () => {
  it('confirms a draft with items once', async () => {
    const id = await createOrder();
    const ok = await call(confirmOrder.onRequestPost, { method: 'POST', token: receptionToken, params: { id: String(id) } });
    expect(ok.status).toBe(200);
    expect((await env.DB.prepare('SELECT status, confirmed_by FROM service_orders WHERE id = ?').bind(id).first())).toEqual({ status: 'confirmed', confirmed_by: 'lt_so' });
    const again = await call(confirmOrder.onRequestPost, { method: 'POST', token: receptionToken, params: { id: String(id) } });
    expect(again.status).toBe(400);
  });

  it('refuses to confirm an order without items', async () => {
    const id = await createOrder({ items: [] });
    const response = await call(confirmOrder.onRequestPost, { method: 'POST', token: managerToken, params: { id: String(id) } });
    expect(response.status).toBe(400);
  });
});

function addDeposit(id, amount, token = managerToken, testEnv = env, extra = {}) {
  return call(orderDeposits.onRequestPost, { method: 'POST', token, params: { id: String(id) }, body: { amount, paymentMethod: 'transfer', ...extra }, testEnv });
}

describe('service order deposits', () => {
  it('records an income row in the primary line linked to the order', async () => {
    const id = await createOrder();
    const response = await addDeposit(id, 3000000, receptionToken, env, { note: 'đợt 1' });
    expect(response.status).toBe(201);
    expect((await response.json()).depositAmount).toBe(3000000);
    const tx = await env.DB.prepare('SELECT type, category, amount, service_order_id, note FROM finance_transactions WHERE service_order_id = ?').bind(id).first();
    expect(tx).toMatchObject({ type: 'income', category: 'bep_hien_le', amount: 3000000, service_order_id: id });
    expect(tx.note).toBe(`Cọc đơn #${id} — Chị Lan — đợt 1`);
    const dep = await env.DB.prepare('SELECT finance_transaction_id FROM service_order_deposits WHERE order_id = ?').bind(id).first();
    expect(dep.finance_transaction_id).toBeGreaterThan(0);
  });

  it('refuses a deposit above the primary line value', async () => {
    const id = await createOrder();
    expect((await addDeposit(id, 10000001)).status).toBe(400);
    expect((await addDeposit(id, 6000000)).status).toBe(201);
    expect((await addDeposit(id, 4000001)).status).toBe(400);
    expect((await env.DB.prepare('SELECT deposit_amount FROM service_orders WHERE id = ?').bind(id).first()).deposit_amount).toBe(6000000);
  });

  it('two concurrent deposits that together exceed the line: exactly one wins', async () => {
    const id = await createOrder();
    let inner;
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => { inner = await addDeposit(id, 6000000); });
    const outer = await addDeposit(id, 6000000, managerToken, raced);
    expect([inner.status, outer.status].sort()).toEqual([201, 409]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM finance_transactions WHERE service_order_id = ?').bind(id).first()).n).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM service_order_deposits WHERE order_id = ?').bind(id).first()).n).toBe(1);
    expect((await env.DB.prepare('SELECT deposit_amount FROM service_orders WHERE id = ?').bind(id).first()).deposit_amount).toBe(6000000);
  });

  it('a concurrent primary-category change makes the deposit fail with 409', async () => {
    const id = await createOrder();
    let inner;
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => {
      inner = await patch(id, bodyFrom(await detail(id), { primaryCategory: 'hien_le_drinks' }));
    });
    const outer = await addDeposit(id, 2000000, managerToken, raced);
    expect(inner.status).toBe(200);
    expect(outer.status).toBe(409);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM finance_transactions WHERE service_order_id = ?').bind(id).first()).n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM service_order_deposits WHERE order_id = ?').bind(id).first()).n).toBe(0);
    expect((await env.DB.prepare('SELECT deposit_amount FROM service_orders WHERE id = ?').bind(id).first()).deposit_amount).toBe(0);
  });

  it('deleting a deposit needs service_orders.refund and voids its income row', async () => {
    const id = await createOrder();
    const { depositId } = await (await addDeposit(id, 2000000)).json();
    const del = (token) => call(orderDeposit.onRequestDelete, { method: 'DELETE', token, params: { id: String(id), depositId: String(depositId) } });
    expect((await del(receptionToken)).status).toBe(403);
    expect((await del(managerToken)).status).toBe(200);
    const order = await env.DB.prepare('SELECT deposit_amount FROM service_orders WHERE id = ?').bind(id).first();
    expect(order.deposit_amount).toBe(0);
    const tx = await env.DB.prepare('SELECT voided_at FROM finance_transactions WHERE service_order_id = ?').bind(id).first();
    expect(tx.voided_at).not.toBeNull();
    expect((await del(managerToken)).status).toBe(400);
  });

  it('refuses deposits on settled or cancelled orders', async () => {
    const id = await createOrder();
    await env.DB.prepare(`UPDATE service_orders SET status = 'settled' WHERE id = ?`).bind(id).run();
    expect((await addDeposit(id, 100000)).status).toBe(400);
  });
});

async function confirmed(overrides = {}) {
  const id = await createOrder(overrides);
  expect((await call(confirmOrder.onRequestPost, { method: 'POST', token: managerToken, params: { id: String(id) } })).status).toBe(200);
  return id;
}
function settle(id, body = { paymentMethod: 'cash' }, token = managerToken, testEnv = env) {
  return call(settleOrder.onRequestPost, { method: 'POST', token, params: { id: String(id) }, body, testEnv });
}

describe('POST /api/service-orders/:id/settle', () => {
  it('writes one income row per line, subtracting the deposit from the primary line', async () => {
    const id = await confirmed();
    await addDeposit(id, 3000000);
    const response = await settle(id);
    expect(response.status).toBe(200);
    const rows = (await env.DB.prepare(`SELECT category, amount, note FROM finance_transactions
      WHERE service_order_id = ? AND id NOT IN (SELECT finance_transaction_id FROM service_order_deposits) ORDER BY category`).bind(id).all()).results;
    expect(rows.map((r) => [r.category, r.amount])).toEqual([['bep_hien_le', 7000000], ['hien_le_drinks', 1000000]]);
    expect(rows[0].note).toBe(`Tất toán đơn #${id} — Chị Lan`);
    expect(await env.DB.prepare('SELECT status, settlement_payment_method FROM service_orders WHERE id = ?').bind(id).first())
      .toEqual({ status: 'settled', settlement_payment_method: 'cash' });
  });

  it('succeeds with no receipt and no payment method when the deposit covers everything', async () => {
    const id = await confirmed({ items: [{ description: 'Tiệc', quantity: 1, unitPrice: 2000000, financeCategory: 'bep_hien_le' }] });
    await addDeposit(id, 2000000);
    const response = await settle(id, {});
    expect(response.status).toBe(200);
    expect((await response.json()).receipts).toEqual([]);
  });

  it('requires a payment method when something is due, and only for confirmed orders', async () => {
    const draft = await createOrder();
    expect((await settle(draft)).status).toBe(400);
    const id = await confirmed();
    expect((await settle(id, {})).status).toBe(400);
  });

  it('a deposit landing after preflight makes settlement return 409 with no receipts', async () => {
    const id = await confirmed();
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => { await addDeposit(id, 1000000); });
    expect((await settle(id, { paymentMethod: 'cash' }, managerToken, raced)).status).toBe(409);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions WHERE service_order_id = ? AND note LIKE 'Tất toán%'`).bind(id).first()).n).toBe(0);
    await expectNotSettled(id);
  });

  it('an item edit landing between the item read and the guard makes settlement return 409', async () => {
    const id = await confirmed();
    let fired = false;
    const raced = envWithHookBefore(/FROM service_order_items WHERE order_id = \? ORDER BY display_order/, async () => {
      if (fired) return;
      fired = true;
      await env.DB.prepare('UPDATE service_order_items SET quantity = quantity + 1 WHERE order_id = ? AND finance_category = ?').bind(id, 'hien_le_drinks').run();
    });
    expect((await settle(id, { paymentMethod: 'cash' }, managerToken, raced)).status).toBe(409);
    expect(fired).toBe(true);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions WHERE service_order_id = ? AND note LIKE 'Tất toán%'`).bind(id).first()).n).toBe(0);
    await expectNotSettled(id);
  });
});

async function expectNotSettled(id) {
  expect((await env.DB.prepare('SELECT status FROM service_orders WHERE id = ?').bind(id).first()).status).toBe('confirmed');
  expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_order_settle'`).first()).n).toBe(0);
}

function cancel(id, body, token = managerToken, testEnv = env) {
  return call(cancelOrder.onRequestPost, { method: 'POST', token, params: { id: String(id) }, body, testEnv });
}

describe('POST /api/service-orders/:id/cancel', () => {
  it('lets reception cancel an order without deposit; reason is required', async () => {
    const id = await createOrder();
    expect((await cancel(id, { origin: 'guest', reason: '' }, receptionToken)).status).toBe(400);
    expect((await cancel(id, { origin: 'guest', reason: 'Khách đổi kế hoạch' }, receptionToken)).status).toBe(200);
    expect(await env.DB.prepare('SELECT status, cancellation_origin, refund_amount FROM service_orders WHERE id = ?').bind(id).first())
      .toEqual({ status: 'cancelled', cancellation_origin: 'guest', refund_amount: 0 });
  });

  it('refuses reception (no refund permission) on an order with a deposit, even with refund 0', async () => {
    const id = await createOrder();
    await addDeposit(id, 1000000);
    const response = await cancel(id, { origin: 'guest', reason: 'Huỷ', refundAmount: 0 }, receptionToken);
    expect(response.status).toBe(403);
    expect((await env.DB.prepare('SELECT status FROM service_orders WHERE id = ?').bind(id).first()).status).toBe('draft');
  });

  it('records a hoan_coc expense for a partial refund and keeps the rest as revenue', async () => {
    const id = await createOrder();
    await addDeposit(id, 2000000);
    const response = await cancel(id, { origin: 'hotel', reason: 'Trùng lịch', refundAmount: 1500000, refundPaymentMethod: 'transfer' });
    expect(response.status).toBe(200);
    const order = await env.DB.prepare('SELECT refund_amount, refund_payment_method, refund_finance_transaction_id FROM service_orders WHERE id = ?').bind(id).first();
    expect(order).toMatchObject({ refund_amount: 1500000, refund_payment_method: 'transfer' });
    const tx = await env.DB.prepare('SELECT type, category, amount, service_order_id FROM finance_transactions WHERE id = ?').bind(order.refund_finance_transaction_id).first();
    expect(tx).toEqual({ type: 'expense', category: 'hoan_coc', amount: 1500000, service_order_id: id });
  });

  it('rejects a refund above the deposit, a missing method and a refund without any deposit', async () => {
    const id = await createOrder();
    expect((await cancel(id, { origin: 'guest', reason: 'x', refundAmount: 1 })).status).toBe(400);
    await addDeposit(id, 1000000);
    expect((await cancel(id, { origin: 'guest', reason: 'x', refundAmount: 1000001, refundPaymentMethod: 'cash' })).status).toBe(400);
    expect((await cancel(id, { origin: 'guest', reason: 'x', refundAmount: 500000 })).status).toBe(400);
    expect((await cancel(id, { origin: 'guest', reason: 'x' })).status).toBe(400);
  });

  it('cannot cancel a settled order', async () => {
    const id = await confirmed();
    await settle(id);
    expect((await cancel(id, { origin: 'guest', reason: 'x' })).status).toBe(400);
  });

  it('a deposit landing after preflight makes a reception cancel return 409 and cancels nothing', async () => {
    const id = await createOrder();
    const raced = envWithHookBefore(/INSERT INTO audit_log/, async () => { await addDeposit(id, 1000000); });
    expect((await cancel(id, { origin: 'guest', reason: 'x' }, receptionToken, raced)).status).toBe(409);
    expect((await env.DB.prepare('SELECT status FROM service_orders WHERE id = ?').bind(id).first()).status).toBe('draft');
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_order_cancel'`).first()).n).toBe(0);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM finance_transactions WHERE service_order_id = ? AND category = 'hoan_coc'`).bind(id).first()).n).toBe(0);
  });
});

describe('PATCH /api/service-orders/:id/hide', () => {
  it('hides only settled/cancelled orders, with records.hide, and audits record_hide', async () => {
    const id = await createOrder();
    const hide = (token) => call(hideOrder.onRequestPatch, { method: 'PATCH', token, params: { id: String(id) }, body: { hidden: true } });
    expect((await hide(managerToken)).status).toBe(403);
    expect((await hide(adminToken)).status).toBe(400);
    await cancel(id, { origin: 'guest', reason: 'x' });
    expect((await hide(adminToken)).status).toBe(200);
    expect((await env.DB.prepare('SELECT is_hidden FROM service_orders WHERE id = ?').bind(id).first()).is_hidden).toBe(1);
    expect((await env.DB.prepare(`SELECT entity_type, old_value, new_value FROM audit_log WHERE action_type = 'record_hide'`).first()))
      .toEqual({ entity_type: 'service_order', old_value: 'hiện', new_value: 'ẩn' });
  });
});

describe('/api/quote-settings', () => {
  const VALID = { businessName: 'Hiền Lê Garden', address: 'Lâm Đồng', hotline: '0968 987 311', email: 'hello@hienlegarden.vn', website: 'hienlegarden.vn',
    defaultValidDays: 10, defaultDepositPercent: 40, taxNote: 'Giá trên chưa bao gồm thuế VAT', cancellationTerms: 'Điều khoản', footerNote: '',
    bankName: 'Ngân hàng A', bankAccount: '123', bankHolder: 'HKD' };
  it('reception can read, cannot write; manager writes a new version without bank details in audit', async () => {
    expect((await call(quoteSettings.onRequestGet, { url: 'https://x/api/quote-settings', token: receptionToken })).status).toBe(200);
    expect((await call(quoteSettings.onRequestPut, { method: 'PUT', url: 'https://x/api/quote-settings', token: receptionToken, body: VALID })).status).toBe(403);
    expect((await call(quoteSettings.onRequestPut, { method: 'PUT', url: 'https://x/api/quote-settings', token: managerToken, body: VALID })).status).toBe(200);
    const read = await (await call(quoteSettings.onRequestGet, { url: 'https://x/api/quote-settings', token: receptionToken })).json();
    expect(read).toMatchObject({ defaultValidDays: 10, defaultDepositPercent: 40, bankAccount: '123', updatedBy: 'ql_so' });
    const audit = await env.DB.prepare(`SELECT new_value FROM audit_log WHERE action_type = 'quote_settings_update'`).first();
    expect(audit.new_value).not.toContain('123');
  });
  it('new orders take validity and deposit percent from the latest settings', async () => {
    await call(quoteSettings.onRequestPut, { method: 'PUT', url: 'https://x/api/quote-settings', token: managerToken, body: VALID });
    const id = await createOrder();
    expect(await env.DB.prepare('SELECT quote_valid_days, requested_deposit FROM service_orders WHERE id = ?').bind(id).first())
      .toEqual({ quote_valid_days: 10, requested_deposit: 4400000 });
  });
});
