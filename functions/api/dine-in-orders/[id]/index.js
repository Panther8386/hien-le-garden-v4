import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const order = await env.DB.prepare(
    `SELECT id, table_label AS tableLabel, note, status, opened_by AS openedBy, opened_at AS openedAt,
       closed_by AS closedBy, closed_at AS closedAt, payment_method AS paymentMethod, total_amount AS totalAmount
     FROM dine_in_orders WHERE id = ?`
  ).bind(params.id).first();
  if (!order) return jsonError('Không tìm thấy order', 404);

  const { results: items } = await env.DB.prepare(
    `SELECT id, menu_item_id AS menuItemId, name, unit_price AS unitPrice, quantity, amount, status,
       created_by AS createdBy, created_at AS createdAt, voided_by AS voidedBy, voided_at AS voidedAt
     FROM dine_in_order_items WHERE order_id = ? ORDER BY created_at ASC`
  ).bind(params.id).all();

  return new Response(JSON.stringify({ ...order, items }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
