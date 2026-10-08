import { requireAuth } from '../../../../lib/requireAuth.js';
import { canSeeHidden } from '../../../../lib/hiddenAccess.js';
import { withDineInPaymentStatus } from '../../../../lib/dineInPaymentStatus.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, 'dine_in.view');
  if (auth instanceof Response) return auth;

  const order = await env.DB.prepare(
    `SELECT o.id, o.table_label AS tableLabel, o.note, o.status, o.opened_by AS openedBy, o.opened_at AS openedAt,
       o.closed_by AS closedBy, o.closed_at AS closedAt, o.payment_method AS paymentMethod, o.total_amount AS totalAmount, o.is_hidden,
       f.type AS receiptType, f.amount AS receiptAmount, f.status AS receiptStatus, f.voided_at AS receiptVoidedAt
     FROM dine_in_orders o LEFT JOIN finance_transactions f ON f.id = o.finance_transaction_id WHERE o.id = ?`
  ).bind(params.id).first();
  // A hidden order answers exactly like a non-existent id for anyone without records.hide.
  if (!order || !canSeeHidden(auth, order)) return jsonError('Không tìm thấy order', 404);
  delete order.is_hidden;

  const { results: items } = await env.DB.prepare(
    `SELECT id, menu_item_id AS menuItemId, name, unit_price AS unitPrice, quantity, amount, status,
       created_by AS createdBy, created_at AS createdAt, voided_by AS voidedBy, voided_at AS voidedAt
     FROM dine_in_order_items WHERE order_id = ? ORDER BY created_at ASC`
  ).bind(params.id).all();

  return new Response(JSON.stringify({ ...withDineInPaymentStatus(order), items }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
