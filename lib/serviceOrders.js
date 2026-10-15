// Shared rules for service orders (spec 2026-10-15). Server-side only.
import { requireAuth } from './requireAuth.js';
import { hasPermission } from './permissions.js';
import { canSeeHidden } from './hiddenAccess.js';

export const ORDER_TYPES = ['an_uong_theo_yeu_cau', 'su_kien', 'dat_tiec', 'khac'];
export const ORDER_TYPE_LABELS = {
  an_uong_theo_yeu_cau: 'Ăn uống theo yêu cầu', su_kien: 'Tổ chức sự kiện', dat_tiec: 'Đặt tiệc', khac: 'Khác',
};
export const PAYMENT_METHODS = ['cash', 'transfer'];
export const OPEN_STATUSES = ['draft', 'confirmed'];
export const MAX_BODY_BYTES = 65536;
export const LIMITS = Object.freeze({
  customerName: 200, organization: 200, phone: 30, note: 2000, venueNote: 2000, description: 500, reason: 1000,
  items: 100, quantity: 100000, unitPrice: 1000000000, total: 10000000000, guestCount: 100000, validDays: 365,
});
export const NOT_FOUND = 'Không tìm thấy đơn dịch vụ';
export const STALE = 'Đơn vừa thay đổi, vui lòng tải lại';
export const DEPOSIT_EXCEEDS = 'Tổng cọc không được vượt giá trị mảng chính của đơn';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[0-9+().\s-]{6,30}$/;
// Identifiers interpolated into SQL come only from these server-owned lists.
const ACTIONS = new Set(['service_order_update', 'service_order_confirm', 'service_order_deposit',
  'service_order_deposit_delete', 'service_order_settle', 'service_order_cancel']);
const STATUS_SET = new Set(['draft', 'confirmed', 'settled', 'cancelled']);

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
export function jsonError(message, status) {
  return json({ error: message }, status);
}

function text(value, max, required = false) {
  if (value == null) return required ? { error: true } : { value: null };
  if (typeof value !== 'string') return { error: true };
  const v = value.trim();
  if (!v) return required ? { error: true } : { value: null };
  if (v.length > max) return { error: true };
  return { value: v };
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isIncomeChoice(categoryMeta, slug, keptSlug) {
  const meta = categoryMeta[slug];
  return !!meta && meta.type === 'income' && (meta.isActive || slug === keptSlug);
}

export function validateOrderFields(body, categoryMeta, currentPrimary = null) {
  if (!body || typeof body !== 'object') return { error: 'Dữ liệu không hợp lệ' };
  if (!ORDER_TYPES.includes(body.orderType)) return { error: 'Loại đơn không hợp lệ' };
  const customerName = text(body.customerName, LIMITS.customerName, true);
  if (customerName.error) return { error: 'Vui lòng nhập tên khách (tối đa 200 ký tự)' };
  const phone = text(body.phone, LIMITS.phone, true);
  if (phone.error || !PHONE_RE.test(phone.value)) return { error: 'Số điện thoại không hợp lệ' };
  const organization = text(body.organization, LIMITS.organization);
  if (organization.error) return { error: 'Tên đơn vị tối đa 200 ký tự' };
  const note = text(body.note, LIMITS.note);
  if (note.error) return { error: 'Ghi chú tối đa 2000 ký tự' };
  const venueNote = text(body.venueNote, LIMITS.venueNote);
  if (venueNote.error) return { error: 'Khu vực / yêu cầu tối đa 2000 ký tự' };
  if (!isValidDate(body.eventDate)) return { error: 'Ngày diễn ra không hợp lệ' };
  const eventTime = body.eventTime == null || body.eventTime === '' ? null : body.eventTime;
  if (eventTime !== null && !TIME_RE.test(eventTime)) return { error: 'Giờ diễn ra không hợp lệ' };
  const guestCount = body.guestCount == null || body.guestCount === '' ? null : body.guestCount;
  if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > LIMITS.guestCount)) {
    return { error: 'Số khách không hợp lệ' };
  }
  const bookingId = body.bookingId == null || body.bookingId === '' ? null : body.bookingId;
  if (bookingId !== null && (!Number.isInteger(bookingId) || bookingId < 1)) return { error: 'Booking liên kết không hợp lệ' };
  if (!isIncomeChoice(categoryMeta, body.primaryCategory, currentPrimary)) {
    return { error: 'Mảng chính phải là danh mục thu đang hoạt động' };
  }
  if (!Number.isInteger(body.quoteValidDays) || body.quoteValidDays < 1 || body.quoteValidDays > LIMITS.validDays) {
    return { error: 'Hiệu lực báo giá phải từ 1 đến 365 ngày' };
  }
  if (!Number.isInteger(body.requestedDeposit) || body.requestedDeposit < 0 || body.requestedDeposit > LIMITS.total) {
    return { error: 'Cọc đề nghị không hợp lệ' };
  }
  return { value: {
    orderType: body.orderType, customerName: customerName.value, phone: phone.value, organization: organization.value,
    note: note.value, eventDate: body.eventDate, eventTime, guestCount, venueNote: venueNote.value, bookingId,
    primaryCategory: body.primaryCategory, quoteValidDays: body.quoteValidDays, requestedDeposit: body.requestedDeposit,
  } };
}

export function validateItems(items, categoryMeta, currentItems = []) {
  if (!Array.isArray(items)) return { error: 'Danh sách dòng không hợp lệ' };
  if (items.length > LIMITS.items) return { error: `Tối đa ${LIMITS.items} dòng mỗi đơn` };
  const byId = new Map(currentItems.map((i) => [i.id, i]));
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return { error: 'Dòng không hợp lệ' };
    let id = null;
    if (raw.id != null) {
      if (!byId.has(raw.id) || seen.has(raw.id)) return { error: 'Dòng không thuộc đơn này' };
      id = raw.id;
      seen.add(id);
    }
    const description = text(raw.description, LIMITS.description, true);
    if (description.error) return { error: 'Mỗi dòng cần mô tả (tối đa 500 ký tự)' };
    if (!Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > LIMITS.quantity) return { error: 'Số lượng không hợp lệ' };
    if (!Number.isInteger(raw.unitPrice) || raw.unitPrice < 0 || raw.unitPrice > LIMITS.unitPrice) return { error: 'Đơn giá không hợp lệ' };
    const kept = id !== null ? byId.get(id).financeCategory : null;
    if (!isIncomeChoice(categoryMeta, raw.financeCategory, kept)) return { error: 'Mảng của dòng phải là danh mục thu đang hoạt động' };
    total += raw.quantity * raw.unitPrice;
    if (total > LIMITS.total) return { error: 'Tổng đơn vượt giới hạn cho phép' };
    out.push({ id, description: description.value, quantity: raw.quantity, unitPrice: raw.unitPrice, financeCategory: raw.financeCategory });
  }
  return { value: out };
}

export function categoryTotals(items) {
  const totals = {};
  for (const i of items) totals[i.financeCategory] = (totals[i.financeCategory] || 0) + i.quantity * i.unitPrice;
  return totals;
}

export function orderTotal(items) {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
}

export function settlementPlan(items, primaryCategory, depositAmount) {
  return Object.entries(categoryTotals(items))
    .map(([category, total]) => ({ category, amount: category === primaryCategory ? total - depositAmount : total }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function roundDeposit(total, percent) {
  return Math.round((total * percent) / 100 / 1000) * 1000;
}

export function quoteNumber(id, createdAt) {
  return `BG-${String(createdAt).slice(0, 4)}-${String(id).padStart(4, '0')}`;
}

export const itemsSnapshotSql = `(SELECT COALESCE(json_group_array(json_array(id, description, quantity, unit_price, finance_category)), '[]')
  FROM (SELECT id, description, quantity, unit_price, finance_category FROM service_order_items WHERE order_id = ? ORDER BY id))`;

export async function readSnapshot(db, orderId) {
  const row = await db.prepare(`SELECT ${itemsSnapshotSql} AS snap`).bind(orderId).first();
  return row.snap;
}

// Opaque optimistic-lock token the client echoes back on PATCH.
export function orderVersion(row, snapshot) {
  return `${row.updated_at || ''}|${row.deposit_amount}|${row.status}|${snapshot}`;
}

// Binds: [orderId, depositAmount, primaryCategory, orderId, itemsSnapshot].
export function orderGuardSql(statuses) {
  if (!statuses.length || !statuses.every((s) => STATUS_SET.has(s))) throw new Error('Unknown status');
  return `EXISTS (SELECT 1 FROM service_orders WHERE id = ? AND status IN (${statuses.map((s) => `'${s}'`).join(', ')})
    AND deposit_amount = ? AND primary_category = ? AND ${itemsSnapshotSql} = ?)`;
}

// Contract: the gate matches on the audit row's content (entity_id + new_value), so every caller's audit
// newValue MUST carry a per-request unique nonce (e.g. key: crypto.randomUUID()); otherwise an older
// identical audit row would satisfy the gate.
export function gateSql(action) {
  if (!ACTIONS.has(action)) throw new Error('Unknown action');
  return `EXISTS (SELECT 1 FROM audit_log WHERE action_type = '${action}' AND entity_type = 'service_order'
    AND entity_id = ? AND new_value = ?)`;
}

// First statement of every mutating batch: the audit row exists only if the guard held.
// Contract: newValue must carry a per-request unique nonce (see gateSql).
export function auditInsert(db, action, orderId, newValue, actor, now, guardSql, guardBinds) {
  if (!ACTIONS.has(action)) throw new Error('Unknown action');
  return db.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
    SELECT ?, 'service_order', ?, ?, NULL, ?, ?, ? WHERE ${guardSql}`)
    .bind(action, orderId, `Đơn #${orderId}`, newValue, actor, now, ...guardBinds);
}

export async function requireOrderPermission(request, env, permission) {
  const auth = await requireAuth(request, env, permission);
  if (auth instanceof Response) return auth;
  if (permission !== 'service_orders.view' && !hasPermission(auth, 'service_orders.view')) return jsonError(NOT_FOUND, 404);
  return auth;
}

export async function loadVisibleOrder(env, auth, id) {
  const row = await env.DB.prepare('SELECT * FROM service_orders WHERE id = ?').bind(id).first();
  return row && canSeeHidden(auth, row) ? row : null;
}

export async function loadItems(db, orderId) {
  const { results } = await db.prepare(`SELECT id, description, quantity, unit_price AS unitPrice, finance_category AS financeCategory
    FROM service_order_items WHERE order_id = ? ORDER BY display_order, id`).bind(orderId).all();
  return results;
}

export async function loadDeposits(db, orderId) {
  const { results } = await db.prepare(`SELECT id, amount, payment_method AS paymentMethod, note, finance_transaction_id AS financeTransactionId,
      created_by AS createdBy, created_at AS createdAt, voided_by AS voidedBy, voided_at AS voidedAt
    FROM service_order_deposits WHERE order_id = ? ORDER BY id`).bind(orderId).all();
  return results;
}

export async function checkBookingLink(env, auth, bookingId) {
  if (bookingId == null) return null;
  const booking = await env.DB.prepare('SELECT id, is_hidden FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!booking || !hasPermission(auth, 'bookings.view') || !canSeeHidden(auth, booking)) {
    return jsonError('Booking liên kết không tồn tại', 400);
  }
  return null;
}

export function coerceOrderSummary(r) {
  return {
    id: r.id, quoteNumber: quoteNumber(r.id, r.created_at), orderType: r.order_type, customerName: r.customer_name, phone: r.phone,
    organization: r.organization, eventDate: r.event_date, eventTime: r.event_time, guestCount: r.guest_count,
    bookingId: r.booking_id, primaryCategory: r.primary_category, depositAmount: r.deposit_amount, status: r.status,
    total: r.total ?? 0, isHidden: !!r.is_hidden, createdAt: r.created_at, settledAt: r.settled_at, cancelledAt: r.cancelled_at,
  };
}

export function coerceOrder(r, items, deposits) {
  return {
    ...coerceOrderSummary({ ...r, total: orderTotal(items) }),
    note: r.note, venueNote: r.venue_note, quoteValidDays: r.quote_valid_days, requestedDeposit: r.requested_deposit,
    createdBy: r.created_by, updatedBy: r.updated_by, updatedAt: r.updated_at, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at,
    settledBy: r.settled_by, settlementPaymentMethod: r.settlement_payment_method, cancelledBy: r.cancelled_by,
    cancellationOrigin: r.cancellation_origin, cancelReason: r.cancel_reason, refundAmount: r.refund_amount,
    refundPaymentMethod: r.refund_payment_method, items, deposits, categoryTotals: categoryTotals(items),
  };
}
