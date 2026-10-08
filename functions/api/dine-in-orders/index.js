import { requireAuth } from '../../../lib/requireAuth.js';
import { hasPermission } from '../../../lib/permissions.js';
import { withDineInPaymentStatus } from '../../../lib/dineInPaymentStatus.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_STATUSES = ['open', 'closed', 'voided'];

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'dine_in.view');
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open';
  if (!VALID_STATUSES.includes(status)) return jsonError('Trạng thái không hợp lệ', 400);
  const includeHidden = url.searchParams.get('includeHidden') === '1' && hasPermission(auth, 'records.hide');

  const { results } = await env.DB.prepare(
    `SELECT o.id, o.table_label AS tableLabel, o.note, o.status, o.opened_by AS openedBy, o.opened_at AS openedAt, o.is_hidden AS isHidden,
       o.closed_at AS closedAt, o.payment_method AS paymentMethod, o.total_amount AS totalAmount,
       f.type AS receiptType, f.amount AS receiptAmount, f.status AS receiptStatus,
       COALESCE((SELECT SUM(amount) FROM dine_in_order_items WHERE order_id = o.id AND status = 'posted'), 0) AS currentTotal
     FROM dine_in_orders o LEFT JOIN finance_transactions f ON f.id = o.finance_transaction_id
     WHERE o.status = ?${includeHidden ? '' : ' AND o.is_hidden = 0'} ORDER BY o.opened_at ASC`
  ).bind(status).all();

  return new Response(JSON.stringify(results.map((r) => {
    const display = withDineInPaymentStatus({ ...r, isHidden: !!r.isHidden });
    // Preserve the open/voided list contract; settlement metadata is for closed orders.
    if (r.status !== 'closed') {
      delete display.closedAt; delete display.paymentMethod; delete display.totalAmount;
    }
    return display;
  })), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, 'dine_in.manage');
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { tableLabel, note } = body || {};
  if (typeof tableLabel !== 'string' || tableLabel.trim() === '') return jsonError('Vui lòng nhập số bàn', 400);
  if (tableLabel.trim().length > 100) return jsonError('Số bàn quá dài', 400);
  if (note !== undefined && note !== null && typeof note !== 'string') return jsonError('Ghi chú không hợp lệ', 400);
  if (note !== undefined && note !== null && typeof note === 'string' && note.trim().length > 500) return jsonError('Ghi chú quá dài', 400);

  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO dine_in_orders (table_label, note, status, opened_by, opened_at) VALUES (?, ?, 'open', ?, ?)`
  ).bind(tableLabel.trim(), note ? (note.trim() || null) : null, auth.username, now).run();

  return new Response(JSON.stringify({ id: insert.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
