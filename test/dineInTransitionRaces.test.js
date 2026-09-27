// FA-5: dine-in order transitions (and item add/void, which depend on the order being open) must
// be enforced at the write, and a request that lost a race must leave NO side effects.
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as addItem } from '../functions/api/dine-in-orders/[id]/items/index.js';
import { onRequestPatch as voidItem } from '../functions/api/dine-in-orders/[id]/items/[itemId].js';
import { onRequestPost as voidOrder } from '../functions/api/dine-in-orders/[id]/void.js';
import { onRequestPost as closeOrder } from '../functions/api/dine-in-orders/[id]/close.js';
import { createSession } from '../lib/auth.js';
import { envWithHookBefore } from './helpers/raceEnv.js';

let token, menuItemId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM dine_in_order_items');
  await env.DB.exec('DELETE FROM dine_in_orders');
  await env.DB.exec('DELETE FROM dine_in_menu_items');
  await env.DB.exec('DELETE FROM audit_log');
  await env.DB.exec(`DELETE FROM finance_transactions`);

  const s = await env.DB.prepare(
    `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_race', 'x', 'reception', '2026-09-04T00:00:00Z')`
  ).run();
  token = await createSession(env.DB, s.meta.last_row_id);
  const m = await env.DB.prepare(
    `INSERT INTO dine_in_menu_items (name, category, price, updated_at) VALUES ('Cà phê', 'do_uong', 30000, '2026-09-04T00:00:00Z')`
  ).run();
  menuItemId = m.meta.last_row_id;
});

function req(path, method, body) {
  return new Request(`https://x${path}`, {
    method,
    headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function openOrderWithItem() {
  const o = await env.DB.prepare(
    `INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn R', 'open', 'le_tan_race', '2026-09-04T08:00:00Z')`
  ).run();
  const orderId = o.meta.last_row_id;
  const i = await env.DB.prepare(
    `INSERT INTO dine_in_order_items (order_id, menu_item_id, name, unit_price, quantity, amount, status, created_by, created_at)
     VALUES (?, ?, 'Cà phê', 30000, 1, 30000, 'posted', 'le_tan_race', '2026-09-04T08:01:00Z')`
  ).bind(orderId, menuItemId).run();
  return { orderId, itemId: i.meta.last_row_id };
}

const count = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first()).n;
const orderRow = (id) => env.DB.prepare(`SELECT status, finance_transaction_id FROM dine_in_orders WHERE id = ?`).bind(id).first();

const close = (id, e = env) => closeOrder({ request: req(`/api/dine-in-orders/${id}/close`, 'POST', { paymentMethod: 'cash' }), env: e, params: { id: String(id) } });
const voidO = (id, e = env) => voidOrder({ request: req(`/api/dine-in-orders/${id}/void`, 'POST'), env: e, params: { id: String(id) } });
const add = (id, e = env) => addItem({ request: req(`/api/dine-in-orders/${id}/items`, 'POST', { menuItemId, quantity: 2 }), env: e, params: { id: String(id) } });
const voidI = (id, itemId, e = env) => voidItem({ request: req(`/api/dine-in-orders/${id}/items/${itemId}`, 'PATCH', {}), env: e, params: { id: String(id), itemId: String(itemId) } });

describe('FA-5 order void', () => {
  it('stale state: a close landing before the void write keeps the order closed, its income intact, and writes no void audit', async () => {
    const { orderId } = await openOrderWithItem();
    let closeRes;
    const racedEnv = envWithHookBefore(/UPDATE dine_in_orders SET status = 'voided'/, async () => {
      closeRes = await close(orderId);
    });
    const res = await voidO(orderId, racedEnv);
    expect(closeRes.status).toBe(200);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Chỉ có thể huỷ bàn khi còn đang mở');
    const row = await orderRow(orderId);
    expect(row.status).toBe('closed');
    const tx = await env.DB.prepare(`SELECT amount, voided_at FROM finance_transactions WHERE id = ?`).bind(row.finance_transaction_id).first();
    expect(tx).toEqual({ amount: 30000, voided_at: null });
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'dine_in_order_void'`)).toBe(0);
  });

  it('void vs close in parallel: exactly one applies; a voided order has no income row, a closed one has exactly one', async () => {
    const { orderId } = await openOrderWithItem();
    const [v, c] = await Promise.all([voidO(orderId), close(orderId)]);
    expect([v.status, c.status].filter((s) => s === 200).length).toBe(1);
    const row = await orderRow(orderId);
    const income = await count(`SELECT COUNT(*) AS n FROM finance_transactions WHERE category = 'khach_vang_lai'`);
    const voidAudits = await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'dine_in_order_void'`);
    if (v.status === 200) {
      expect(row.status).toBe('voided');
      expect(income).toBe(0);
      expect(voidAudits).toBe(1);
    } else {
      expect(row.status).toBe('closed');
      expect(income).toBe(1);
      expect(voidAudits).toBe(0);
    }
  });
});

describe('FA-5 order close', () => {
  it('stale state: a void landing before the close write leaves no income row (regression guard)', async () => {
    const { orderId } = await openOrderWithItem();
    let voidRes;
    const racedEnv = envWithHookBefore(/UPDATE dine_in_orders SET status = 'closed'/, async () => {
      voidRes = await voidO(orderId);
    });
    const res = await close(orderId, racedEnv);
    expect(voidRes.status).toBe(200);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Bàn này vừa được chốt hoặc huỷ bởi thao tác khác, vui lòng tải lại');
    expect((await orderRow(orderId)).status).toBe('voided');
    expect(await count(`SELECT COUNT(*) AS n FROM finance_transactions`)).toBe(0);
  });

  it('a DB error on the close write removes the just-created income row (no orphan finance row)', async () => {
    const { orderId } = await openOrderWithItem();
    const failingEnv = envWithHookBefore(/UPDATE dine_in_orders SET status = 'closed'/, async () => {
      throw new Error('D1 temporarily unavailable');
    });
    const res = await close(orderId, failingEnv);
    expect(res.status).toBe(500);
    expect((await orderRow(orderId)).status).toBe('open');
    expect(await count(`SELECT COUNT(*) AS n FROM finance_transactions`)).toBe(0);
  });
});

describe('FA-5 item add', () => {
  it('stale state: an order closed between pre-check and insert gets no new item', async () => {
    const { orderId } = await openOrderWithItem();
    const racedEnv = envWithHookBefore(/INSERT INTO dine_in_order_items/, async () => {
      expect((await close(orderId)).status).toBe(200);
    });
    const res = await add(orderId, racedEnv);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Chỉ có thể thêm món khi bàn còn đang mở');
    expect(await count(`SELECT COUNT(*) AS n FROM dine_in_order_items WHERE order_id = ?`, orderId)).toBe(1);
  });

  it('still adds an item to an open order (201)', async () => {
    const { orderId } = await openOrderWithItem();
    const res = await add(orderId);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = await env.DB.prepare(`SELECT order_id, amount, status FROM dine_in_order_items WHERE id = ?`).bind(id).first();
    expect(row).toEqual({ order_id: orderId, amount: 60000, status: 'posted' });
  });
});

describe('FA-5 item void', () => {
  it('stale state: an order closed between pre-check and write keeps the item posted and writes no audit', async () => {
    const { orderId, itemId } = await openOrderWithItem();
    const racedEnv = envWithHookBefore(/UPDATE dine_in_order_items SET status = 'voided'/, async () => {
      expect((await close(orderId)).status).toBe(200);
    });
    const res = await voidI(orderId, itemId, racedEnv);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Chỉ có thể huỷ dòng khi bàn còn đang mở');
    const item = await env.DB.prepare(`SELECT status FROM dine_in_order_items WHERE id = ?`).bind(itemId).first();
    expect(item.status).toBe('posted');
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_void'`)).toBe(0);
  });

  it('stale state: a double void writes exactly one audit row and the loser gets the already-voided error', async () => {
    const { orderId, itemId } = await openOrderWithItem();
    let first;
    const racedEnv = envWithHookBefore(/UPDATE dine_in_order_items SET status = 'voided'/, async () => {
      first = await voidI(orderId, itemId);
    });
    const res = await voidI(orderId, itemId, racedEnv);
    expect(first.status).toBe(200);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Dòng này đã được huỷ trước đó');
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'service_void'`)).toBe(1);
  });
});
