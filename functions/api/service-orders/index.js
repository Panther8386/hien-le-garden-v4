import { hasPermission } from '../../../lib/permissions.js';
import { readJsonBody } from '../../../lib/readJsonBody.js';
import { loadCategoryMeta } from '../../../lib/financeCategories.js';
import { redactContact } from '../../../lib/redactContact.js';
import { loadQuoteSettings } from '../../../lib/quoteSettings.js';
import {
  ORDER_TYPES, MAX_BODY_BYTES, json, jsonError, requireOrderPermission, validateOrderFields, validateItems,
  orderTotal, roundDeposit, checkBookingLink, coerceOrderSummary,
} from '../../../lib/serviceOrders.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.view');
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const q = url.searchParams.get('q');
  const includeHidden = url.searchParams.get('includeHidden') === '1';
  const clauses = [];
  const params = [];
  if (status === 'open') clauses.push(`status IN ('draft', 'confirmed')`);
  else if (status === 'history') clauses.push(`status IN ('settled', 'cancelled')`);
  else if (status) return jsonError('Trạng thái không hợp lệ', 400);
  if (type) {
    if (!ORDER_TYPES.includes(type)) return jsonError('Loại đơn không hợp lệ', 400);
    clauses.push('order_type = ?'); params.push(type);
  }
  if (from) { if (!DATE_RE.test(from)) return jsonError('Ngày không hợp lệ', 400); clauses.push('event_date >= ?'); params.push(from); }
  if (to) { if (!DATE_RE.test(to)) return jsonError('Ngày không hợp lệ', 400); clauses.push('event_date <= ?'); params.push(to); }
  if (q) {
    if (q.length > 100) return jsonError('Từ khoá quá dài', 400);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    clauses.push(`(customer_name LIKE ? ESCAPE '\\' OR organization LIKE ? ESCAPE '\\'${hasPermission(auth, 'guests.contact_view') ? ` OR phone LIKE ? ESCAPE '\\'` : ''})`);
    params.push(like, like);
    if (hasPermission(auth, 'guests.contact_view')) params.push(like);
  }
  if (includeHidden && !hasPermission(auth, 'records.hide')) return jsonError('Không đủ quyền', 403);
  if (!includeHidden) clauses.push('is_hidden = 0');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = status === 'history' ? 'COALESCE(settled_at, cancelled_at) DESC, id DESC' : 'event_date ASC, event_time ASC, id ASC';
  const { results } = await env.DB.prepare(`SELECT o.*, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM service_order_items i WHERE i.order_id = o.id) AS total
    FROM service_orders o ${where} ORDER BY ${order} LIMIT 500`).bind(...params).all();
  const rows = results.map(coerceOrderSummary);
  redactContact(auth, rows);
  return json(rows);
}

export async function onRequestPost({ request, env }) {
  const auth = await requireOrderPermission(request, env, 'service_orders.manage');
  if (auth instanceof Response) return auth;
  const parsed = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const categoryMeta = await loadCategoryMeta(env);
  const items = validateItems(body.items ?? [], categoryMeta, []);
  if (items.error) return jsonError(items.error, 400);
  const settings = await loadQuoteSettings(env.DB);
  const fields = validateOrderFields({
    ...body,
    quoteValidDays: body.quoteValidDays ?? settings.defaultValidDays,
    requestedDeposit: body.requestedDeposit ?? roundDeposit(orderTotal(items.value), settings.defaultDepositPercent),
  }, categoryMeta, null);
  if (fields.error) return jsonError(fields.error, 400);
  const linkError = await checkBookingLink(env, auth, fields.value.bookingId);
  if (linkError) return linkError;

  const f = fields.value;
  const now = new Date().toISOString();
  const key = crypto.randomUUID();
  const orderRef = '(SELECT id FROM service_orders WHERE creation_key = ?)';
  const summary = JSON.stringify({ orderType: f.orderType, eventDate: f.eventDate, total: orderTotal(items.value), items: items.value.length });
  const statements = [
    env.DB.prepare(`INSERT INTO service_orders (creation_key, order_type, customer_name, phone, organization, note, event_date, event_time,
        guest_count, venue_note, booking_id, primary_category, quote_valid_days, requested_deposit, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(key, f.orderType, f.customerName, f.phone, f.organization, f.note, f.eventDate, f.eventTime, f.guestCount, f.venueNote,
        f.bookingId, f.primaryCategory, f.quoteValidDays, f.requestedDeposit, auth.username, now),
    env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
      SELECT 'service_order_create', 'service_order', id, 'Đơn #' || id, NULL, ?, ?, ? FROM service_orders WHERE creation_key = ?`)
      .bind(summary, auth.username, now, key),
    ...items.value.map((it, index) => env.DB.prepare(`INSERT INTO service_order_items (order_id, description, quantity, unit_price, finance_category, display_order)
      SELECT ${orderRef}, ?, ?, ?, ?, ?`).bind(key, it.description, it.quantity, it.unitPrice, it.financeCategory, index)),
  ];
  const results = await env.DB.batch(statements);
  return json({ id: results[0].results[0].id }, 201);
}
