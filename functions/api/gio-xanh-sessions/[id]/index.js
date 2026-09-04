import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const session = await env.DB.prepare(
    `SELECT s.id, s.room_id AS roomId, r.name AS roomName, s.guest_name AS guestName, s.phone, s.status,
       s.opened_by AS openedBy, s.opened_at AS openedAt, s.closed_by AS closedBy, s.closed_at AS closedAt,
       s.payment_method AS paymentMethod, s.total_amount AS totalAmount
     FROM gio_xanh_sessions s JOIN rooms r ON r.id = s.room_id
     WHERE s.id = ?`
  ).bind(params.id).first();
  if (!session) return jsonError('Không tìm thấy phiên', 404);

  const { results: items } = await env.DB.prepare(
    `SELECT id, source, source_id AS sourceId, name, unit_price AS unitPrice, quantity, amount, status,
       created_by AS createdBy, created_at AS createdAt, voided_by AS voidedBy, voided_at AS voidedAt
     FROM gio_xanh_session_items WHERE session_id = ? ORDER BY created_at ASC`
  ).bind(params.id).all();

  return new Response(JSON.stringify({ ...session, items }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
