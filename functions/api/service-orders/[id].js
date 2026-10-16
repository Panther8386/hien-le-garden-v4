import { hasPermission } from '../../../lib/permissions.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';
import { loadCategoryMeta } from '../../../lib/financeCategories.js';
import { redactContact } from '../../../lib/redactContact.js';
import {
  json, jsonError, NOT_FOUND, STALE, DEPOSIT_EXCEEDS, PRIMARY_LOCKED, OPEN_STATUSES, MAX_BODY_BYTES, requireOrderPermission, loadVisibleOrder,
  loadItems, loadDeposits, loadFinanceRows, coerceOrder, validateOrderFields, validateItems, categoryTotals, orderTotal, checkBookingLink,
  readSnapshot, orderVersion, orderGuardSql, gateSql, auditInsert,
} from '../../../lib/serviceOrders.js';

export async function onRequestGet({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.view');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  const snapshot = await readSnapshot(env.DB, order.id);
  const out = coerceOrder(order, await loadItems(env.DB, order.id), await loadDeposits(env.DB, order.id));
  out.version = await orderVersion(order, snapshot);
  out.financeRows = await loadFinanceRows(env.DB, order.id);
  redactContact(auth, out);
  return json(out);
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const order = await loadVisibleOrder(env, auth, params.id);
  if (!order) return jsonError(NOT_FOUND, 404);
  if (!OPEN_STATUSES.includes(order.status)) return jsonError('Chỉ sửa được đơn nháp hoặc đã chốt', 400);
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (typeof body.version !== 'string') return jsonError('Thiếu phiên bản đơn, vui lòng tải lại', 400);
  // Snapshot first, then items: an item added in between fails the guard instead of escaping the delete set.
  const snapshot = await readSnapshot(env.DB, order.id);
  const currentItems = await loadItems(env.DB, order.id);
  if (body.version !== await orderVersion(order, snapshot)) return jsonError(STALE, 409);
  // An editor who cannot see contacts receives phone = null; never overwrite the stored value.
  if (!hasPermission(auth, 'guests.contact_view')) body.phone = order.phone;
  const categoryMeta = await loadCategoryMeta(env);
  const fields = validateOrderFields(body, categoryMeta, order.primary_category);
  if (fields.error) return jsonError(fields.error, 400);
  const primaryChange = fields.value.primaryCategory !== order.primary_category;
  if (primaryChange && order.deposit_amount > 0) return jsonError(PRIMARY_LOCKED, 400);
  const items = validateItems(body.items, categoryMeta, currentItems);
  if (items.error) return jsonError(items.error, 400);
  if (order.status === 'confirmed' && items.value.length === 0) return jsonError('Đơn đã chốt phải có ít nhất 1 dòng', 400);
  if (fields.value.bookingId !== order.booking_id) {
    const linkError = await checkBookingLink(env, auth, fields.value.bookingId);
    if (linkError) return linkError;
  }
  if (order.deposit_amount > (categoryTotals(items.value)[fields.value.primaryCategory] || 0)) return jsonError(DEPOSIT_EXCEEDS, 400);

  const f = fields.value;
  const now = new Date().toISOString();
  const auditValue = JSON.stringify({ key: crypto.randomUUID(), total: orderTotal(items.value), items: items.value.length });
  const gate = gateSql('service_order_update');
  const gateBinds = [order.id, auditValue];
  const keep = new Set(items.value.filter((i) => i.id !== null).map((i) => i.id));
  // Re-checked at write time: the primary line may only move while no deposit is live. A deposit landing after
  // preflight is already caught by orderGuardSql's deposit_amount pin; this clause is the explicit backstop.
  const primaryGuard = '(primary_category = ? OR deposit_amount = 0)';
  const statements = [
    auditInsert(env.DB, 'service_order_update', order.id, auditValue, auth.username, now,
      `${orderGuardSql([order.status])} AND EXISTS (SELECT 1 FROM service_orders WHERE id = ? AND COALESCE(updated_at, '') = ?
        AND ${primaryGuard})`,
      [order.id, order.deposit_amount, order.primary_category, order.id, snapshot, order.id, order.updated_at || '', f.primaryCategory]),
    env.DB.prepare(`UPDATE service_orders SET order_type = ?, customer_name = ?, phone = ?, organization = ?, note = ?, event_date = ?,
        event_time = ?, guest_count = ?, venue_note = ?, booking_id = ?, primary_category = ?, quote_valid_days = ?, requested_deposit = ?,
        updated_by = ?, updated_at = ? WHERE id = ? AND ${primaryGuard} AND ${gate}`)
      .bind(f.orderType, f.customerName, f.phone, f.organization, f.note, f.eventDate, f.eventTime, f.guestCount, f.venueNote,
        f.bookingId, f.primaryCategory, f.quoteValidDays, f.requestedDeposit, auth.username, now, order.id, f.primaryCategory, ...gateBinds),
    ...currentItems.filter((c) => !keep.has(c.id)).map((c) => env.DB.prepare(
      `DELETE FROM service_order_items WHERE id = ? AND order_id = ? AND ${gate}`).bind(c.id, order.id, ...gateBinds)),
    ...items.value.map((it, index) => (it.id !== null
      ? env.DB.prepare(`UPDATE service_order_items SET description = ?, quantity = ?, unit_price = ?, finance_category = ?, display_order = ?
          WHERE id = ? AND order_id = ? AND ${gate}`)
        .bind(it.description, it.quantity, it.unitPrice, it.financeCategory, index, it.id, order.id, ...gateBinds)
      : env.DB.prepare(`INSERT INTO service_order_items (order_id, description, quantity, unit_price, finance_category, display_order)
          SELECT ?, ?, ?, ?, ?, ? WHERE ${gate}`)
        .bind(order.id, it.description, it.quantity, it.unitPrice, it.financeCategory, index, ...gateBinds))),
  ];
  const results = await env.DB.batch(statements);
  if (!results[0].meta.changes) return jsonError(STALE, 409);
  return json({ ok: true });
}
