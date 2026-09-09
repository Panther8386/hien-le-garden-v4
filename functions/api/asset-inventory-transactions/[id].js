import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT id, voided_at FROM asset_inventory_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy giao dịch', 404);
  if (existing.voided_at) return jsonError('Giao dịch này đã bị huỷ trước đó', 400);

  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE asset_inventory_transactions SET voided_by = ?, voided_at = ? WHERE id = ?`)
    .bind(auth.username, now, params.id)
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
