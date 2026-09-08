// v4/functions/api/asset-inventory-batches/[id]/refresh-lines.js
import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager']);
  if (auth instanceof Response) return auth;

  const batch = await env.DB.prepare(`SELECT * FROM asset_inventory_batches WHERE id = ?`).bind(params.id).first();
  if (!batch) return jsonError('Không tìm thấy đợt kiểm kê', 404);
  if (batch.status === 'closed') return jsonError('Đợt kiểm kê đã chốt, không thể làm mới danh sách', 400);

  const { results: assetsAtLocation } = await env.DB.prepare(
    `SELECT id, quantity FROM assets WHERE location_id = ? AND is_deleted = 0`
  ).bind(batch.location_id).all();

  const { results: existingLines } = await env.DB.prepare(`SELECT asset_id FROM asset_inventory_lines WHERE batch_id = ?`).bind(params.id).all();
  const existingAssetIds = new Set(existingLines.map((l) => l.asset_id));

  const newAssets = assetsAtLocation.filter((a) => !existingAssetIds.has(a.id));
  if (newAssets.length > 0) {
    const inserts = newAssets.map((a) =>
      env.DB.prepare(`INSERT INTO asset_inventory_lines (batch_id, asset_id, book_quantity) VALUES (?, ?, ?)`).bind(params.id, a.id, a.quantity)
    );
    await env.DB.batch(inserts);
  }

  return new Response(JSON.stringify({ ok: true, addedCount: newAssets.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
