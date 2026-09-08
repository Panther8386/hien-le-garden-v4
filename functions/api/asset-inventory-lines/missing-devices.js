// v4/functions/api/asset-inventory-lines/missing-devices.js
import { requireAuth } from '../../../lib/requireAuth.js';

function coerceRow(r) {
  return {
    id: r.id,
    batchId: r.batch_id,
    batchLabel: r.batch_label,
    locationId: r.location_id,
    locationName: r.location_name,
    closedAt: r.closed_at,
    assetId: r.asset_id,
    assetName: r.asset_name,
    internalCode: r.internal_code,
    note: r.note,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT l.id, l.batch_id, b.label AS batch_label, b.location_id, loc.name AS location_name, b.closed_at,
            l.asset_id, a.name AS asset_name, a.internal_code, l.note
     FROM asset_inventory_lines l
     JOIN asset_inventory_batches b ON b.id = l.batch_id
     JOIN asset_locations loc ON loc.id = b.location_id
     JOIN assets a ON a.id = l.asset_id
     JOIN asset_categories c ON c.id = a.category_id
     WHERE b.status = 'closed' AND l.actual_quantity = 0 AND c.management_type IN ('individual_device', 'device_set') AND a.is_deleted = 0
     ORDER BY b.closed_at DESC`
  ).all();

  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
