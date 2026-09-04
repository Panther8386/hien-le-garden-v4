import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_STATUSES = ['open', 'closed', 'voided'];

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open';
  if (!VALID_STATUSES.includes(status)) return jsonError('Trạng thái không hợp lệ', 400);

  const { results } = await env.DB.prepare(
    `SELECT o.id, o.table_label AS tableLabel, o.note, o.status, o.opened_by AS openedBy, o.opened_at AS openedAt,
       COALESCE((SELECT SUM(amount) FROM dine_in_order_items WHERE order_id = o.id AND status = 'posted'), 0) AS currentTotal
     FROM dine_in_orders o WHERE o.status = ? ORDER BY o.opened_at ASC`
  ).bind(status).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
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
