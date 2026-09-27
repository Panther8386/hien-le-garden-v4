// P1: an action permission never lets an actor mutate a resource they may not see.
// Every mutation-by-id endpoint requires the resource's VIEW permission; without it
// the endpoint answers exactly like a non-existent id (same 404 status and body)
// and writes nothing. Default roles always pair manage with view, so only
// deny-overrides / unusual grants are affected.
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSession } from '../lib/auth.js';
import { setOverride } from './helpers/permissions.js';

import { onRequestPost as bookingCheckIn } from '../functions/api/bookings/[id]/check-in.js';
import { onRequestPost as bookingCheckOut } from '../functions/api/bookings/[id]/check-out.js';
import { onRequestPost as bookingCancel } from '../functions/api/bookings/[id]/cancel.js';
import { onRequestPost as bookingConfirm } from '../functions/api/bookings/[id]/confirm.js';
import { onRequestPost as bookingReject } from '../functions/api/bookings/[id]/reject.js';
import { onRequestPatch as bookingIdentity } from '../functions/api/bookings/[id]/identity.js';
import { onRequestPost as bookingAddDeposit } from '../functions/api/bookings/[id]/deposits/index.js';
import { onRequestDelete as bookingDeleteDeposit } from '../functions/api/bookings/[id]/deposits/[depositId].js';
import { onRequestPost as bookingAddService } from '../functions/api/bookings/[id]/services/index.js';
import { onRequestPatch as bookingVoidService } from '../functions/api/bookings/[id]/services/[itemId].js';
import { onRequestPost as roomClean } from '../functions/api/rooms/[id]/clean.js';
import { onRequestPatch as roomPrice } from '../functions/api/rooms/[id]/price.js';
import { onRequestPost as dineVoid } from '../functions/api/dine-in-orders/[id]/void.js';
import { onRequestPost as dineClose } from '../functions/api/dine-in-orders/[id]/close.js';
import { onRequestPost as dineAddItem } from '../functions/api/dine-in-orders/[id]/items/index.js';
import { onRequestPatch as dineVoidItem } from '../functions/api/dine-in-orders/[id]/items/[itemId].js';
import { onRequestPost as gxVoid } from '../functions/api/gio-xanh-sessions/[id]/void.js';
import { onRequestPost as gxClose } from '../functions/api/gio-xanh-sessions/[id]/close.js';
import { onRequestPost as gxAddItem } from '../functions/api/gio-xanh-sessions/[id]/items/index.js';
import { onRequestPatch as gxVoidItem } from '../functions/api/gio-xanh-sessions/[id]/items/[itemId].js';
import { onRequestPatch as finPatch } from '../functions/api/finance/transactions/[id].js';
import { onRequestPatch as finVoid } from '../functions/api/finance/transactions/[id]/void.js';
import { onRequestPatch as finHide } from '../functions/api/finance/transactions/[id]/hide.js';
import { onRequestPost as finAttachPost, onRequestDelete as finAttachDelete } from '../functions/api/finance/transactions/[id]/attachment.js';
import { onRequestPatch as finCategoryPatch } from '../functions/api/finance/categories/[id].js';
import { onRequestPatch as finCategoryMove } from '../functions/api/finance/categories/[id]/move.js';
import { onRequestPost as customerSend } from '../functions/api/customers/[id]/send.js';
import { onRequestPut as templatePut, onRequestDelete as templateDelete } from '../functions/api/templates/[id].js';
import { onRequestPost as templateActivate } from '../functions/api/templates/[id]/activate.js';
import { onRequestPost as templateDeactivate } from '../functions/api/templates/[id]/deactivate.js';
import { onRequestPatch as assetPatch, onRequestDelete as assetDelete } from '../functions/api/assets/[id].js';
import { onRequestPost as assetPhotoPost, onRequestDelete as assetPhotoDelete } from '../functions/api/assets/[id]/photo.js';
import { onRequestPatch as batchPatch } from '../functions/api/asset-inventory-batches/[id].js';
import { onRequestPost as batchRefresh } from '../functions/api/asset-inventory-batches/[id]/refresh-lines.js';
import { onRequestPatch as linePatch } from '../functions/api/asset-inventory-lines/[id].js';
import { onRequestPost as linePhotoPost, onRequestDelete as linePhotoDelete } from '../functions/api/asset-inventory-lines/[id]/photo.js';
import { onRequestDelete as invTxDelete } from '../functions/api/asset-inventory-transactions/[id].js';
import { onRequestPatch as categoryPatch } from '../functions/api/asset-categories/[id].js';
import { onRequestPatch as locationPatch } from '../functions/api/asset-locations/[id].js';
import { onRequestPost as sourceRowReconcile } from '../functions/api/asset-source-rows/[id]/reconcile.js';

const MISSING = 987654;
let seq = 0;
let adminToken;

async function actor(role, overrides = []) {
  const username = `mv_${role}_${++seq}`;
  const r = await env.DB.prepare(
    `INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES (?, 'x', ?, '2026-09-27T00:00:00Z')`
  ).bind(username, role).run();
  const id = r.meta.last_row_id;
  for (const [permission, effect] of overrides) await setOverride(env.DB, id, permission, effect);
  return createSession(env.DB, id);
}

function jsonReq(token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request('https://x/api/test', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function formReq(token, method) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'anh.jpg', { type: 'image/jpeg' }));
  return new Request('https://x/api/test', { method, headers: { Cookie: `session=${token}` }, body: method === 'POST' ? form : undefined });
}

async function rows(sql, ...binds) {
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results;
}

// invoke(token, id) → Response. The reference response is the endpoint's own
// missing-id answer, taken by an admin (who can see everything) on an id that
// does not exist.
async function expectLikeMissing(invoke, token, id, snapshot) {
  const before = await snapshot();
  const denied = await invoke(token, id);
  const reference = await invoke(adminToken, MISSING);
  expect(reference.status).toBe(404);
  expect(denied.status).toBe(404);
  expect(await denied.json()).toEqual(await reference.json());
  expect(await snapshot()).toEqual(before);
}

beforeEach(async () => {
  adminToken = await actor('admin');
});

// ---------- fixtures ----------
async function firstRoomId(type = 'vip') {
  return (await env.DB.prepare(`SELECT id FROM rooms WHERE room_type = ? ORDER BY id LIMIT 1`).bind(type).first()).id;
}

async function booking(status = 'confirmed') {
  const roomId = await firstRoomId('vip');
  const r = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, phone, room_type, room_id, check_in, check_out, status, source, created_at)
     VALUES ('Khách MV', '0900', 'vip', ?, '2099-02-01', '2099-02-03', ?, 'website', '2026-09-01T00:00:00Z')`
  ).bind(roomId, status).run();
  return r.meta.last_row_id;
}

const bookingSnap = (id) => () => rows(`SELECT * FROM bookings WHERE id = ?`, id);

async function dineOrder() {
  const o = await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at) VALUES ('Bàn MV', 'open', 'x', '2026-09-04T08:00:00Z')`).run();
  const orderId = o.meta.last_row_id;
  const i = await env.DB.prepare(`INSERT INTO dine_in_order_items (order_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'Mì Quảng', 45000, 1, 45000, 'posted', 'x', '2026-09-04T08:05:00Z')`).bind(orderId).run();
  const m = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Cà phê MV', 'do_uong', 25000, 'CÀ PHÊ', 0, 1, 'system', '2026-08-01T00:00:00Z')`).run();
  return { orderId, itemId: i.meta.last_row_id, menuItemId: m.meta.last_row_id };
}

const dineSnap = (orderId) => async () => ({
  order: await rows(`SELECT * FROM dine_in_orders WHERE id = ?`, orderId),
  items: await rows(`SELECT * FROM dine_in_order_items WHERE order_id = ? ORDER BY id`, orderId),
});

async function gxSession() {
  const roomId = await firstRoomId('vip');
  const s = await env.DB.prepare(`INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at) VALUES (?, 'Khách GX', 'open', 'x', '2026-09-04T08:00:00Z')`).bind(roomId).run();
  const sessionId = s.meta.last_row_id;
  const i = await env.DB.prepare(`INSERT INTO gio_xanh_session_items (session_id, source, source_id, name, unit_price, quantity, amount, status, created_by, created_at) VALUES (?, 'mon_an_uong', 1, 'Cà phê', 25000, 1, 25000, 'posted', 'x', '2026-09-04T08:05:00Z')`).bind(sessionId).run();
  const m = await env.DB.prepare(`INSERT INTO dine_in_menu_items (name, category, price, subgroup, display_order, is_active, updated_by, updated_at) VALUES ('Trà MV', 'do_uong', 20000, 'TRÀ', 0, 1, 'system', '2026-08-01T00:00:00Z')`).run();
  return { sessionId, itemId: i.meta.last_row_id, menuItemId: m.meta.last_row_id };
}

const gxSnap = (sessionId) => async () => ({
  session: await rows(`SELECT * FROM gio_xanh_sessions WHERE id = ?`, sessionId),
  items: await rows(`SELECT * FROM gio_xanh_session_items WHERE session_id = ? ORDER BY id`, sessionId),
});

async function financeTx(type = 'income', { voided = false, receiptKey = null } = {}) {
  const r = await env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, voided_by, voided_at, receipt_key)
     VALUES (?, ?, 100000, 'MV', '2026-09-01', 'confirmed', 'x', '2026-09-01T00:00:00Z', ?, ?, ?)`
  ).bind(type, type === 'income' ? 'ban_hang' : 'vat_tu', voided ? 'x' : null, voided ? '2026-09-02T00:00:00Z' : null, receiptKey).run();
  return r.meta.last_row_id;
}

const finSnap = (id) => () => rows(`SELECT * FROM finance_transactions WHERE id = ?`, id);

async function assetFixture() {
  const n = ++seq;
  const cat = await env.DB.prepare(`INSERT INTO asset_categories (management_type, name, default_unit, is_active, created_by, created_at) VALUES ('individual_device', ?, 'cái', 1, 'x', '2026-09-07T00:00:00Z')`).bind(`Điều hoà MV ${n}`).run();
  const loc = await env.DB.prepare(`INSERT INTO asset_locations (location_type, name, created_by, created_at) VALUES ('common_area', ?, 'x', '2026-09-08T00:00:00Z')`).bind(`Sảnh MV ${n}`).run();
  const categoryId = cat.meta.last_row_id;
  const locationId = loc.meta.last_row_id;
  const a = await env.DB.prepare(`INSERT INTO assets (category_id, name, source_type, location_id, quantity, created_by, created_at, photo_key) VALUES (?, 'Máy lạnh MV', 'handover_a', ?, 1, 'x', '2026-09-08T00:00:00Z', 'assets/mv.jpg')`).bind(categoryId, locationId).run();
  const assetId = a.meta.last_row_id;
  const b = await env.DB.prepare(`INSERT INTO asset_inventory_batches (location_id, label, status, created_by, created_at) VALUES (?, 'Đợt MV', 'counting', 'x', '2026-09-08T00:00:00Z')`).bind(locationId).run();
  const batchId = b.meta.last_row_id;
  const l = await env.DB.prepare(`INSERT INTO asset_inventory_lines (batch_id, asset_id, book_quantity, photo_key) VALUES (?, ?, 1, 'lines/mv.jpg')`).bind(batchId, assetId).run();
  const t = await env.DB.prepare(`INSERT INTO asset_inventory_transactions (category_id, location_id, movement_type, quantity_delta, unit, created_by, created_at) VALUES (?, ?, 'opening', 20, 'cái', 'x', '2026-09-09T00:00:00Z')`).bind(categoryId, locationId).run();
  const d = await env.DB.prepare(`INSERT INTO asset_source_documents (title, created_by, created_at) VALUES ('Hồ sơ MV', 'x', '2026-09-07T00:00:00Z')`).run();
  const s = await env.DB.prepare(`INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_quantity, created_at) VALUES (?, 'B', 1, 'Điều hoà', '3', '2026-09-07T00:00:00Z')`).bind(d.meta.last_row_id).run();
  return { categoryId, locationId, assetId, batchId, lineId: l.meta.last_row_id, txId: t.meta.last_row_id, sourceRowId: s.meta.last_row_id };
}

const assetSnap = (f) => async () => ({
  assets: await rows(`SELECT * FROM assets ORDER BY id`),
  categories: await rows(`SELECT * FROM asset_categories WHERE id = ?`, f.categoryId),
  locations: await rows(`SELECT * FROM asset_locations WHERE id = ?`, f.locationId),
  batches: await rows(`SELECT * FROM asset_inventory_batches WHERE id = ?`, f.batchId),
  lines: await rows(`SELECT * FROM asset_inventory_lines WHERE batch_id = ? ORDER BY id`, f.batchId),
  tx: await rows(`SELECT * FROM asset_inventory_transactions WHERE id = ?`, f.txId),
});

// ---------- bookings ----------
describe('bookings/[id]/* require bookings.view', () => {
  it('check-in by a bookings.manage holder with bookings.view denied answers like a missing id and writes nothing', async () => {
    const token = await actor('manager', [['bookings.view', 'deny']]);
    const id = await booking('confirmed');
    await expectLikeMissing((t, bid) => bookingCheckIn({ request: jsonReq(t, 'POST'), env, params: { id: String(bid) } }), token, id, bookingSnap(id));
  });

  it('every other booking transition/child mutation is refused the same way', async () => {
    const token = await actor('manager', [['bookings.view', 'deny'], ['bookings.deposit_delete', 'grant'], ['bookings.edit_paid_service', 'grant']]);
    const confirmedId = await booking('confirmed');
    const pendingId = await booking('pending');
    const checkedInId = await booking('checked_in');
    const roomId = await firstRoomId('vip');
    const dep = await env.DB.prepare(`INSERT INTO booking_deposits (booking_id, amount, payment_method, created_by, created_at) VALUES (?, 200000, 'cash', 'x', '2026-09-08T00:00:00Z')`).bind(confirmedId).run();
    const svc = await env.DB.prepare(`INSERT INTO booking_service_items (booking_id, name, unit_price, quantity, amount, status, created_by, created_at, payment_status) VALUES (?, 'DV MV', 50000, 1, 50000, 'posted', 'x', '2026-08-01T00:00:00Z', 'pending')`).bind(confirmedId).run();
    const snap = async () => ({
      bookings: await rows(`SELECT * FROM bookings WHERE id IN (?, ?, ?) ORDER BY id`, confirmedId, pendingId, checkedInId),
      deposits: await rows(`SELECT * FROM booking_deposits ORDER BY id`),
      services: await rows(`SELECT * FROM booking_service_items ORDER BY id`),
      finance: await rows(`SELECT COUNT(*) AS n FROM finance_transactions`),
    });
    const P = (id, extra = {}) => ({ id: String(id), ...extra });
    await expectLikeMissing((t, id) => bookingCancel({ request: jsonReq(t, 'POST', { reason: 'x', paymentMethod: 'cash' }), env, params: P(id) }), token, confirmedId, snap);
    await expectLikeMissing((t, id) => bookingConfirm({ request: jsonReq(t, 'POST', { rooms: [{ roomType: 'vip', roomId }] }), env, params: P(id) }), token, pendingId, snap);
    await expectLikeMissing((t, id) => bookingReject({ request: jsonReq(t, 'POST', { reason: 'x' }), env, params: P(id) }), token, pendingId, snap);
    await expectLikeMissing((t, id) => bookingCheckOut({ request: jsonReq(t, 'POST', { paymentMethod: 'cash' }), env, params: P(id) }), token, checkedInId, snap);
    await expectLikeMissing((t, id) => bookingIdentity({ request: jsonReq(t, 'PATCH', { idNumber: '0123', nationality: 'VN' }), env, params: P(id) }), token, confirmedId, snap);
    await expectLikeMissing((t, id) => bookingAddDeposit({ request: jsonReq(t, 'POST', { amount: 100000, paymentMethod: 'cash' }), env, params: P(id) }), token, confirmedId, snap);
    await expectLikeMissing((t, id) => bookingAddService({ request: jsonReq(t, 'POST', { name: 'DV', unitPrice: 1000, quantity: 1 }), env, params: P(id) }), token, confirmedId, snap);
    // Child endpoints: the reference is the endpoint's missing-child answer.
    await expectLikeMissing((t, id) => bookingDeleteDeposit({ request: jsonReq(t, 'DELETE'), env, params: P(id === MISSING ? MISSING : confirmedId, { depositId: String(id === MISSING ? MISSING : dep.meta.last_row_id) }) }), token, confirmedId, snap);
    await expectLikeMissing((t, id) => bookingVoidService({ request: jsonReq(t, 'PATCH'), env, params: { id: String(confirmedId), itemId: String(id === MISSING ? MISSING : svc.meta.last_row_id) } }), token, confirmedId, snap);
  });

  it('regression: a default manager (view + manage) still checks in', async () => {
    const token = await actor('manager');
    const id = await booking('confirmed');
    const res = await bookingCheckIn({ request: jsonReq(token, 'POST'), env, params: { id: String(id) } });
    expect(res.status).toBe(200);
    expect((await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first()).status).toBe('checked_in');
  });
});

// ---------- rooms ----------
describe('rooms/[id] mutations require bookings.view', () => {
  it('clean by a bookings.manage holder with bookings.view denied answers like a missing room', async () => {
    const token = await actor('reception', [['bookings.view', 'deny']]);
    const id = await firstRoomId('vip');
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1, needs_cleaning_since = '2026-09-27T00:00:00Z' WHERE id = ?`).bind(id).run();
    await expectLikeMissing((t, rid) => roomClean({ request: jsonReq(t, 'POST'), env, params: { id: String(rid) } }), token, id, () => rows(`SELECT * FROM rooms WHERE id = ?`, id));
  });

  it('price by a settings.rooms holder without bookings.view answers like a missing room', async () => {
    const token = await actor('observer', [['bookings.view', 'deny'], ['settings.rooms', 'grant']]);
    const id = await firstRoomId('vip');
    await expectLikeMissing((t, rid) => roomPrice({ request: jsonReq(t, 'PATCH', { priceWeekday: 1, priceWeekend: 2 }), env, params: { id: String(rid) } }), token, id, () => rows(`SELECT * FROM rooms WHERE id = ?`, id));
  });

  it('regression: reception still marks a room clean; settings.rooms + bookings.view still sets price', async () => {
    const id = await firstRoomId('vip');
    await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 1 WHERE id = ?`).bind(id).run();
    const reception = await actor('reception');
    expect((await roomClean({ request: jsonReq(reception, 'POST'), env, params: { id: String(id) } })).status).toBe(200);
    expect((await env.DB.prepare(`SELECT needs_cleaning FROM rooms WHERE id = ?`).bind(id).first()).needs_cleaning).toBe(0);
    const pricer = await actor('reception', [['settings.rooms', 'grant']]);
    expect((await roomPrice({ request: jsonReq(pricer, 'PATCH', { priceWeekday: 111, priceWeekend: 222 }), env, params: { id: String(id) } })).status).toBe(200);
  });
});

// ---------- dine-in ----------
describe('dine-in-orders/[id]/* require dine_in.view', () => {
  it('void, close, item add and item void are refused like a missing id when dine_in.view is denied', async () => {
    const token = await actor('reception', [['dine_in.view', 'deny']]);
    const f = await dineOrder();
    const snap = dineSnap(f.orderId);
    await expectLikeMissing((t, id) => dineVoid({ request: jsonReq(t, 'POST'), env, params: { id: String(id) } }), token, f.orderId, snap);
    await expectLikeMissing((t, id) => dineClose({ request: jsonReq(t, 'POST', { paymentMethod: 'cash', expectedTotal: 45000 }), env, params: { id: String(id) } }), token, f.orderId, snap);
    await expectLikeMissing((t, id) => dineAddItem({ request: jsonReq(t, 'POST', { menuItemId: f.menuItemId, quantity: 1 }), env, params: { id: String(id) } }), token, f.orderId, snap);
    await expectLikeMissing((t, id) => dineVoidItem({ request: jsonReq(t, 'PATCH'), env, params: { id: String(f.orderId), itemId: String(id === MISSING ? MISSING : f.itemId) } }), token, f.orderId, snap);
  });

  it('regression: default reception still adds an item', async () => {
    const token = await actor('reception');
    const f = await dineOrder();
    const res = await dineAddItem({ request: jsonReq(token, 'POST', { menuItemId: f.menuItemId, quantity: 2 }), env, params: { id: String(f.orderId) } });
    expect(res.status).toBe(201);
  });
});

// ---------- Giờ Xanh ----------
describe('gio-xanh-sessions/[id]/* require gio_xanh.view', () => {
  it('void, close, item add and item void are refused like a missing id when gio_xanh.view is denied', async () => {
    const token = await actor('reception', [['gio_xanh.view', 'deny']]);
    const f = await gxSession();
    const snap = gxSnap(f.sessionId);
    await expectLikeMissing((t, id) => gxVoid({ request: jsonReq(t, 'POST'), env, params: { id: String(id) } }), token, f.sessionId, snap);
    await expectLikeMissing((t, id) => gxClose({ request: jsonReq(t, 'POST', { paymentMethod: 'cash', expectedTotal: 25000 }), env, params: { id: String(id) } }), token, f.sessionId, snap);
    await expectLikeMissing((t, id) => gxAddItem({ request: jsonReq(t, 'POST', { source: 'mon_an_uong', sourceId: f.menuItemId, quantity: 1 }), env, params: { id: String(id) } }), token, f.sessionId, snap);
    await expectLikeMissing((t, id) => gxVoidItem({ request: jsonReq(t, 'PATCH'), env, params: { id: String(f.sessionId), itemId: String(id === MISSING ? MISSING : f.itemId) } }), token, f.sessionId, snap);
  });

  it('regression: default reception still adds a line', async () => {
    const token = await actor('reception');
    const f = await gxSession();
    const res = await gxAddItem({ request: jsonReq(token, 'POST', { source: 'mon_an_uong', sourceId: f.menuItemId, quantity: 1 }), env, params: { id: String(f.sessionId) } });
    expect(res.status).toBe(201);
  });
});

// ---------- finance ----------
describe('finance transactions/[id] mutations require finance.view_income (canSeeTransaction)', () => {
  it('PATCH / void / attachment by a finance.manage holder with both finance view permissions denied answer like a missing id', async () => {
    const token = await actor('manager', [['finance.view_income', 'deny'], ['finance.view_all', 'deny']]);
    const id = await financeTx('income', { receiptKey: 'receipts/mv.jpg' });
    await expectLikeMissing((t, tid) => finPatch({ request: jsonReq(t, 'PATCH', { amount: 1 }), env, params: { id: String(tid) } }), token, id, finSnap(id));
    await expectLikeMissing((t, tid) => finVoid({ request: jsonReq(t, 'PATCH'), env, params: { id: String(tid) } }), token, id, finSnap(id));
    await expectLikeMissing((t, tid) => finAttachDelete({ request: jsonReq(t, 'DELETE'), env, params: { id: String(tid) } }), token, id, finSnap(id));
    await expectLikeMissing((t, tid) => finAttachPost({ request: formReq(t, 'POST'), env, params: { id: String(tid) } }), token, id, finSnap(id));
  });

  it('finance.view_income is required even for a finance.view_all holder', async () => {
    const token = await actor('manager', [['finance.view_income', 'deny']]);
    const id = await financeTx('income');
    await expectLikeMissing((t, tid) => finPatch({ request: jsonReq(t, 'PATCH', { amount: 1 }), env, params: { id: String(tid) } }), token, id, finSnap(id));
  });

  it('former FA-11: a records.hide-only actor cannot hide a voided income row', async () => {
    const token = await actor('reception', [['records.hide', 'grant']]);
    const id = await financeTx('income', { voided: true });
    await expectLikeMissing((t, tid) => finHide({ request: jsonReq(t, 'PATCH', { hidden: true }), env, params: { id: String(tid) } }), token, id, finSnap(id));
  });

  it('regression: default manager still edits; observer + records.hide (has view_income) still hides an income row', async () => {
    const manager = await actor('manager');
    const id = await financeTx('income');
    expect((await finPatch({ request: jsonReq(manager, 'PATCH', { amount: 5000 }), env, params: { id: String(id) } })).status).toBe(200);
    const hider = await actor('observer', [['records.hide', 'grant']]);
    const voidedId = await financeTx('income', { voided: true });
    expect((await finHide({ request: jsonReq(hider, 'PATCH', { hidden: true }), env, params: { id: String(voidedId) } })).status).toBe(200);
  });
});

describe('finance/categories/[id] mutations require seeing the category', () => {
  const catSnap = () => rows(`SELECT * FROM finance_categories ORDER BY id`);
  const catId = async (type) => (await env.DB.prepare(`SELECT id FROM finance_categories WHERE type = ? ORDER BY display_order, id LIMIT 1`).bind(type).first()).id;

  it('a settings.finance_categories holder without finance.view_income cannot edit or move any category', async () => {
    const token = await actor('reception', [['settings.finance_categories', 'grant']]);
    const id = await catId('income');
    await expectLikeMissing((t, cid) => finCategoryPatch({ request: jsonReq(t, 'PATCH', { label: 'Đổi tên' }), env, params: { id: String(cid) } }), token, id, catSnap);
    await expectLikeMissing((t, cid) => finCategoryMove({ request: jsonReq(t, 'PATCH', { direction: 'down' }), env, params: { id: String(cid) } }), token, id, catSnap);
  });

  it('finance.view_income without finance.view_all cannot edit an expense category', async () => {
    const token = await actor('observer', [['settings.finance_categories', 'grant']]);
    const id = await catId('expense');
    await expectLikeMissing((t, cid) => finCategoryPatch({ request: jsonReq(t, 'PATCH', { label: 'Đổi tên' }), env, params: { id: String(cid) } }), token, id, catSnap);
  });

  it('regression: observer + settings.finance_categories edits an income category; manager + grant edits an expense one', async () => {
    const observer = await actor('observer', [['settings.finance_categories', 'grant']]);
    expect((await finCategoryPatch({ request: jsonReq(observer, 'PATCH', { label: 'Thu MV' }), env, params: { id: String(await catId('income')) } })).status).toBe(200);
    const manager = await actor('manager', [['settings.finance_categories', 'grant']]);
    expect((await finCategoryPatch({ request: jsonReq(manager, 'PATCH', { label: 'Chi MV' }), env, params: { id: String(await catId('expense')) } })).status).toBe(200);
  });
});

// ---------- customers ----------
describe('customers/[id]/send requires customers.view', () => {
  async function fixture() {
    const guestId = `fb-mv-${++seq}`;
    await env.DB.prepare(
      `INSERT INTO feedback_responses (id, submitted_at, guest_name, phone, email, telegram_chat_id, rating, consent_given, promo_code, discount_percent, promo_expires_at, promo_status, gift_offered, gift_claimed)
       VALUES (?, '2026-08-20T10:00:00Z', 'Khách MV', '0900000009', 'mv@example.com', NULL, 5, 1, ?, 10, '2099-01-01T00:00:00Z', 'unused', 0, 0)`
    ).bind(guestId, `HLG-MV${seq}`).run();
    const t = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('TG MV', 'telegram', NULL, 'Chào {guestName}', 0, 'x', '2026-08-01T00:00:00Z')`).run();
    return { templateId: t.meta.last_row_id, guestId };
  }

  it('a customers.send holder with customers.view denied gets the missing-customer answer', async () => {
    const { templateId, guestId } = await fixture();
    const token = await actor('reception', [['customers.view', 'deny']]);
    await expectLikeMissing(
      (t, id) => customerSend({ request: jsonReq(t, 'POST', { templateId }), env, params: { id: id === MISSING ? 'fb-missing' : id } }),
      token, guestId, () => rows(`SELECT COUNT(*) AS n FROM audit_log`)
    );
  });

  it('regression: default reception passes the view gate (reaches channel validation)', async () => {
    const { templateId, guestId } = await fixture();
    const token = await actor('reception');
    const res = await customerSend({ request: jsonReq(token, 'POST', { templateId }), env, params: { id: guestId } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Khách chưa kết nối Telegram, không thể gửi qua kênh này');
  });
});

// ---------- templates ----------
describe('templates/[id] mutations require templates.view', () => {
  async function templates() {
    const a = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('A', 'email', 's', 'b', 1, 'x', '2026-08-01T00:00:00Z')`).run();
    const b = await env.DB.prepare(`INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at) VALUES ('B', 'email', 's', 'b', 0, 'x', '2026-08-01T00:00:00Z')`).run();
    return { activeId: a.meta.last_row_id, inactiveId: b.meta.last_row_id };
  }
  const snap = () => rows(`SELECT * FROM message_templates ORDER BY id`);

  it('PUT / DELETE / activate / deactivate by a templates.manage holder with templates.view denied answer like a missing id', async () => {
    const token = await actor('manager', [['templates.view', 'deny']]);
    const { activeId, inactiveId } = await templates();
    await expectLikeMissing((t, id) => templatePut({ request: jsonReq(t, 'PUT', { name: 'X', channel: 'email', subject: 's', body: 'b' }), env, params: { id: String(id) } }), token, inactiveId, snap);
    await expectLikeMissing((t, id) => templateDelete({ request: jsonReq(t, 'DELETE'), env, params: { id: String(id) } }), token, inactiveId, snap);
    await expectLikeMissing((t, id) => templateActivate({ request: jsonReq(t, 'POST'), env, params: { id: String(id) } }), token, inactiveId, snap);
    await expectLikeMissing((t, id) => templateDeactivate({ request: jsonReq(t, 'POST'), env, params: { id: String(id) } }), token, activeId, snap);
  });

  it('regression: default manager still activates a template', async () => {
    const token = await actor('manager');
    const { inactiveId } = await templates();
    expect((await templateActivate({ request: jsonReq(token, 'POST'), env, params: { id: String(inactiveId) } })).status).toBe(200);
  });
});

// ---------- assets & inventory ----------
describe('assets & inventory by-id mutations require assets.view', () => {
  it('every asset/inventory mutation by id answers like a missing id when assets.view is denied', async () => {
    const token = await actor('manager', [['assets.view', 'deny'], ['assets.delete', 'grant'], ['assets.config', 'grant']]);
    const f = await assetFixture();
    const snap = assetSnap(f);
    const P = (id) => ({ id: String(id) });
    await expectLikeMissing((t, id) => assetPatch({ request: jsonReq(t, 'PATCH', { name: 'Đổi' }), env, params: P(id) }), token, f.assetId, snap);
    await expectLikeMissing((t, id) => assetDelete({ request: jsonReq(t, 'DELETE'), env, params: P(id) }), token, f.assetId, snap);
    await expectLikeMissing((t, id) => assetPhotoPost({ request: formReq(t, 'POST'), env, params: P(id) }), token, f.assetId, snap);
    await expectLikeMissing((t, id) => assetPhotoDelete({ request: jsonReq(t, 'DELETE'), env, params: P(id) }), token, f.assetId, snap);
    await expectLikeMissing((t, id) => batchPatch({ request: jsonReq(t, 'PATCH', { status: 'pending_close' }), env, params: P(id) }), token, f.batchId, snap);
    await expectLikeMissing((t, id) => batchRefresh({ request: jsonReq(t, 'POST'), env, params: P(id) }), token, f.batchId, snap);
    await expectLikeMissing((t, id) => linePatch({ request: jsonReq(t, 'PATCH', { actualQuantity: 0 }), env, params: P(id) }), token, f.lineId, snap);
    await expectLikeMissing((t, id) => linePhotoPost({ request: formReq(t, 'POST'), env, params: P(id) }), token, f.lineId, snap);
    await expectLikeMissing((t, id) => linePhotoDelete({ request: jsonReq(t, 'DELETE'), env, params: P(id) }), token, f.lineId, snap);
    await expectLikeMissing((t, id) => invTxDelete({ request: jsonReq(t, 'DELETE'), env, params: P(id) }), token, f.txId, snap);
    await expectLikeMissing((t, id) => categoryPatch({ request: jsonReq(t, 'PATCH', { name: 'Đổi' }), env, params: P(id) }), token, f.categoryId, snap);
    await expectLikeMissing((t, id) => locationPatch({ request: jsonReq(t, 'PATCH', { name: 'Đổi' }), env, params: P(id) }), token, f.locationId, snap);
    await expectLikeMissing((t, id) => sourceRowReconcile({ request: jsonReq(t, 'POST', { categoryId: f.categoryId, locationId: f.locationId, count: 1 }), env, params: P(id) }), token, f.sourceRowId, snap);
  });

  it('regression: default manager still edits an asset and a count line', async () => {
    const token = await actor('manager');
    const f = await assetFixture();
    expect((await assetPatch({ request: jsonReq(token, 'PATCH', { name: 'Máy lạnh mới' }), env, params: { id: String(f.assetId) } })).status).toBe(200);
    expect((await linePatch({ request: jsonReq(token, 'PATCH', { actualQuantity: 1 }), env, params: { id: String(f.lineId) } })).status).toBe(200);
  });
});
