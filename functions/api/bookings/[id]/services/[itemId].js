import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const item = await env.DB.prepare(`SELECT id, booking_id, status FROM booking_service_items WHERE id = ?`).bind(params.itemId).first();
  if (!item || String(item.booking_id) !== String(params.id)) {
    return jsonError('Không tìm thấy dòng dịch vụ', 404);
  }
  if (item.status === 'voided') {
    return jsonError('Dòng dịch vụ này đã được huỷ trước đó', 400);
  }

  await env.DB.prepare(
    `UPDATE booking_service_items SET status = 'voided', voided_by = ?, voided_at = ? WHERE id = ?`
  ).bind(auth.username, new Date().toISOString(), params.itemId).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
