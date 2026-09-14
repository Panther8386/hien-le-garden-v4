import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const PAIRED_MOVEMENT_TYPES = ['transfer_out', 'transfer_in', 'issue', 'soil', 'send_wash', 'return'];

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(
    `SELECT id, category_id, location_id, lot_id, linen_status, quantity_delta, movement_type, voided_at FROM asset_inventory_transactions WHERE id = ?`
  ).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy giao dịch', 404);
  if (existing.voided_at) return jsonError('Giao dịch này đã bị huỷ trước đó', 400);
  if (PAIRED_MOVEMENT_TYPES.includes(existing.movement_type)) {
    return jsonError('Không thể huỷ riêng lẻ giao dịch thuộc một cặp ghi sổ (chuyển kho/chuyển trạng thái đồ vải) — hãy ghi một giao dịch đảo chiều thay vì huỷ', 400);
  }

  const now = new Date().toISOString();

  if (existing.quantity_delta > 0) {
    // Voiding an inflow removes it from the running total — must not drive stock negative.
    const result = await env.DB.prepare(
      `UPDATE asset_inventory_transactions SET voided_by = ?, voided_at = ?
       WHERE id = ? AND voided_at IS NULL
         AND (
           SELECT COALESCE(SUM(quantity_delta), 0) FROM asset_inventory_transactions
           WHERE category_id = ? AND location_id = ?
             AND ((? IS NULL AND lot_id IS NULL) OR lot_id = ?)
             AND (? IS NULL OR linen_status = ?)
             AND voided_at IS NULL
         ) - ? >= 0`
    ).bind(
      auth.username, now, params.id,
      existing.category_id, existing.location_id, existing.lot_id, existing.lot_id, existing.linen_status, existing.linen_status,
      existing.quantity_delta
    ).run();
    if (result.meta.changes === 0) return jsonError('Không thể huỷ vì sẽ khiến tồn kho âm', 400);
  } else {
    // Voiding an outflow only ever increases the total — always safe.
    await env.DB.prepare(`UPDATE asset_inventory_transactions SET voided_by = ?, voided_at = ? WHERE id = ? AND voided_at IS NULL`)
      .bind(auth.username, now, params.id)
      .run();
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
