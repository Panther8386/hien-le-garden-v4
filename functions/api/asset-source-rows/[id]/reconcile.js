import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const INDIVIDUAL_MANAGEMENT_TYPES = ['individual_device', 'device_set'];

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin', 'manager']);
  if (auth instanceof Response) return auth;

  const sourceRow = await env.DB.prepare(`SELECT * FROM asset_source_rows WHERE id = ?`).bind(params.id).first();
  if (!sourceRow) return jsonError('Không tìm thấy dòng nguồn', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  body = body || {};
  const { categoryId, locationId } = body;

  if (!Number.isInteger(categoryId)) return jsonError('Vui lòng chọn danh mục', 400);
  const category = await env.DB.prepare(`SELECT id, management_type FROM asset_categories WHERE id = ?`).bind(categoryId).first();
  if (!category) return jsonError('Không tìm thấy danh mục', 400);

  if (locationId !== undefined && locationId !== null) {
    const location = await env.DB.prepare(`SELECT id FROM asset_locations WHERE id = ?`).bind(locationId).first();
    if (!location) return jsonError('Không tìm thấy vị trí', 400);
  }

  const isIndividual = INDIVIDUAL_MANAGEMENT_TYPES.includes(category.management_type);
  const { reconciled_count: reconciledCount } = await env.DB.prepare(
    `SELECT COALESCE(SUM(quantity), 0) AS reconciled_count FROM assets WHERE source_row_id = ? AND is_deleted = 0`
  ).bind(params.id).first();

  const knownQuantity = sourceRow.raw_quantity !== null ? Number(sourceRow.raw_quantity) : null;
  const isKnownPositiveInteger = knownQuantity !== null && Number.isInteger(knownQuantity) && knownQuantity > 0;

  const now = new Date().toISOString();
  const createdIds = [];

  if (isIndividual) {
    const count = body.count !== undefined ? body.count : 1;
    if (!Number.isInteger(count) || count <= 0) return jsonError('Số lượng tạo phải là số nguyên dương', 400);
    // Bounded independently of the raw_quantity ceiling below, which only applies
    // when raw_quantity is a known positive integer -- without this, a fat-fingered
    // count on a NULL-quantity row would loop unboundedly (3 D1 statements each),
    // risking a subrequest-limit crash mid-loop with the partial assets already
    // persisted (there is no rollback across the loop's individual inserts).
    if (count > 200) return jsonError('Không thể tạo quá 200 tài sản trong một lần', 400);
    if (isKnownPositiveInteger && reconciledCount + count > knownQuantity) {
      return jsonError(`Dòng nguồn này chỉ có ${knownQuantity} theo hồ sơ bàn giao, đã đối chiếu ${reconciledCount} — không thể tạo thêm ${count}`, 400);
    }
    for (let i = 0; i < count; i++) {
      const insert = await env.DB.prepare(
        `INSERT INTO assets (category_id, name, source_type, source_row_id, location_id, quantity, created_by, created_at)
         VALUES (?, ?, 'handover_a', ?, ?, 1, ?, ?)`
      ).bind(categoryId, sourceRow.raw_name, params.id, locationId ?? null, auth.username, now).run();
      const newId = insert.meta.last_row_id;
      const internalCode = `TS${String(newId).padStart(6, '0')}`;
      await env.DB.prepare(`UPDATE assets SET internal_code = ? WHERE id = ?`).bind(internalCode, newId).run();
      await env.DB.prepare(
        `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
         VALUES ('asset_create', 'asset', ?, ?, NULL, ?, ?, ?)`
      ).bind(newId, sourceRow.raw_name, sourceRow.raw_name, auth.username, now).run();
      createdIds.push(newId);
    }
  } else {
    const quantity = body.quantity !== undefined ? body.quantity : null;
    if (quantity !== null && !Number.isInteger(quantity)) return jsonError('Số lượng phải là số nguyên', 400);
    if (isKnownPositiveInteger && quantity !== null && reconciledCount + quantity > knownQuantity) {
      return jsonError(`Dòng nguồn này chỉ có ${knownQuantity} theo hồ sơ bàn giao, đã đối chiếu ${reconciledCount} — không thể tạo thêm ${quantity}`, 400);
    }
    const insert = await env.DB.prepare(
      `INSERT INTO assets (category_id, name, source_type, source_row_id, location_id, quantity, created_by, created_at)
       VALUES (?, ?, 'handover_a', ?, ?, ?, ?, ?)`
    ).bind(categoryId, sourceRow.raw_name, params.id, locationId ?? null, quantity, auth.username, now).run();
    const newId = insert.meta.last_row_id;
    await env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('asset_create', 'asset', ?, ?, NULL, ?, ?, ?)`
    ).bind(newId, sourceRow.raw_name, sourceRow.raw_name, auth.username, now).run();
    createdIds.push(newId);
  }

  return new Response(JSON.stringify({ ok: true, createdIds }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
