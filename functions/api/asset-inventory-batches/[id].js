// v4/functions/api/asset-inventory-batches/[id].js
import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const INDIVIDUAL_MANAGEMENT_TYPES = ['individual_device', 'device_set'];
const NEXT_STATUS = { draft: 'counting', counting: 'pending_close', pending_close: 'closed' };

function coerceBatch(r) {
  return {
    id: r.id,
    locationId: r.location_id,
    label: r.label,
    status: r.status,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    closedBy: r.closed_by,
    closedAt: r.closed_at,
  };
}

function coerceLine(r) {
  return {
    id: r.id,
    batchId: r.batch_id,
    assetId: r.asset_id,
    assetName: r.asset_name,
    internalCode: r.internal_code,
    managementType: r.management_type,
    bookQuantity: r.book_quantity,
    actualQuantity: r.actual_quantity,
    conditionFound: r.condition_found,
    photoFilename: r.photo_filename,
    note: r.note,
    suggestedAction: r.suggested_action,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const batch = await env.DB.prepare(`SELECT * FROM asset_inventory_batches WHERE id = ?`).bind(params.id).first();
  if (!batch) return jsonError('Không tìm thấy đợt kiểm kê', 404);

  const { results: lines } = await env.DB.prepare(
    `SELECT l.*, a.name AS asset_name, a.internal_code, c.management_type
     FROM asset_inventory_lines l
     JOIN assets a ON a.id = l.asset_id
     JOIN asset_categories c ON c.id = a.category_id
     WHERE l.batch_id = ? ORDER BY a.name`
  ).bind(params.id).all();

  return new Response(JSON.stringify({ ...coerceBatch(batch), lines: lines.map(coerceLine) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception']);
  if (auth instanceof Response) return auth;

  const batch = await env.DB.prepare(`SELECT * FROM asset_inventory_batches WHERE id = ?`).bind(params.id).first();
  if (!batch) return jsonError('Không tìm thấy đợt kiểm kê', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { status } = body || {};

  const expectedNext = NEXT_STATUS[batch.status];
  if (!expectedNext || status !== expectedNext) {
    return jsonError(`Không thể chuyển từ trạng thái "${batch.status}" sang "${status}"`, 400);
  }

  // Reception may only move counting -> pending_close; starting a count and
  // closing a batch stay admin/manager-only, matching every other write in
  // this subsystem's "who can finalize official records" boundary.
  if (status === 'counting' && auth.role === 'reception') {
    return jsonError('Không đủ quyền bắt đầu kiểm kê', 403);
  }
  if (status === 'closed' && auth.role === 'reception') {
    return jsonError('Không đủ quyền chốt đợt kiểm kê', 403);
  }

  const now = new Date().toISOString();

  if (status !== 'closed') {
    await env.DB.prepare(`UPDATE asset_inventory_batches SET status = ? WHERE id = ?`).bind(status, params.id).run();
    return new Response(JSON.stringify({ ok: true, status }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Closing: run the spec §5 reconciliation.
  const { results: lines } = await env.DB.prepare(
    `SELECT l.id, l.asset_id, l.actual_quantity, l.book_quantity, a.quantity AS asset_quantity, a.name AS asset_name, c.management_type
     FROM asset_inventory_lines l
     JOIN assets a ON a.id = l.asset_id
     JOIN asset_categories c ON c.id = a.category_id
     WHERE l.batch_id = ?`
  ).bind(params.id).all();

  const statements = [
    env.DB.prepare(`UPDATE asset_inventory_batches SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?`).bind(auth.username, now, params.id),
  ];

  for (const line of lines) {
    if (line.actual_quantity === null || line.actual_quantity === undefined) continue; // never counted -- skip, never confuse with 0
    if (INDIVIDUAL_MANAGEMENT_TYPES.includes(line.management_type)) continue; // individual assets: quantity/location/lifecycle never auto-change
    if (line.actual_quantity === line.asset_quantity) continue; // no change

    statements.push(
      env.DB.prepare(`UPDATE assets SET quantity = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(line.actual_quantity, auth.username, now, line.asset_id)
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
         VALUES ('asset_inventory_adjustment', 'asset', ?, ?, ?, ?, ?, ?)`
      ).bind(line.asset_id, line.asset_name, String(line.asset_quantity), String(line.actual_quantity), auth.username, now)
    );
  }

  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true, status: 'closed' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
