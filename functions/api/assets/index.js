import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_SOURCE_TYPES = ['handover_a', 'purchased_b', 'other'];
const INDIVIDUAL_MANAGEMENT_TYPES = ['individual_device', 'device_set'];

function coerceRow(r) {
  return {
    id: r.id,
    categoryId: r.category_id,
    managementType: r.management_type,
    internalCode: r.internal_code,
    name: r.name,
    brand: r.brand,
    serialNumber: r.serial_number,
    sourceType: r.source_type,
    sourceRowId: r.source_row_id,
    acquiredDate: r.acquired_date,
    purchasePrice: r.purchase_price,
    locationId: r.location_id,
    holder: r.holder,
    quantity: r.quantity,
    physicalCondition: r.physical_condition,
    operationalStatus: r.operational_status,
    lifecycleStatus: r.lifecycle_status,
    photoKey: r.photo_key,
    photoFilename: r.photo_filename,
    photoUploadedAt: r.photo_uploaded_at,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const categoryId = url.searchParams.get('categoryId');
  const locationId = url.searchParams.get('locationId');
  const sourceType = url.searchParams.get('sourceType');
  const managementType = url.searchParams.get('managementType');
  const q = url.searchParams.get('q');

  const clauses = [];
  const params = [];
  if (categoryId) { clauses.push('a.category_id = ?'); params.push(Number(categoryId)); }
  if (locationId) { clauses.push('a.location_id = ?'); params.push(Number(locationId)); }
  if (sourceType) { clauses.push('a.source_type = ?'); params.push(sourceType); }
  if (managementType) { clauses.push('c.management_type = ?'); params.push(managementType); }
  if (q) {
    clauses.push('(a.name LIKE ? COLLATE NOCASE OR a.internal_code LIKE ? COLLATE NOCASE OR a.serial_number LIKE ? COLLATE NOCASE)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await env.DB.prepare(
    `SELECT a.*, c.management_type FROM assets a JOIN asset_categories c ON c.id = a.category_id ${where} ORDER BY a.id DESC`
  ).bind(...params).all();

  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { categoryId, name, brand, serialNumber, sourceType, acquiredDate, purchasePrice, locationId, holder, quantity, note } = body || {};

  if (!Number.isInteger(categoryId)) return jsonError('Vui lòng chọn danh mục', 400);
  const category = await env.DB.prepare(`SELECT id, management_type FROM asset_categories WHERE id = ?`).bind(categoryId).first();
  if (!category) return jsonError('Không tìm thấy danh mục', 400);

  if (typeof name !== 'string' || name.trim() === '') return jsonError('Vui lòng nhập tên tài sản', 400);
  if (!VALID_SOURCE_TYPES.includes(sourceType)) return jsonError('Nguồn hình thành không hợp lệ', 400);

  if (locationId !== undefined && locationId !== null) {
    const location = await env.DB.prepare(`SELECT id FROM asset_locations WHERE id = ?`).bind(locationId).first();
    if (!location) return jsonError('Không tìm thấy vị trí', 400);
  }

  const isIndividual = INDIVIDUAL_MANAGEMENT_TYPES.includes(category.management_type);
  const resolvedQuantity = isIndividual ? 1 : (quantity !== undefined ? quantity : null);
  if (resolvedQuantity !== null && !Number.isInteger(resolvedQuantity)) return jsonError('Số lượng phải là số nguyên', 400);

  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO assets (category_id, name, brand, serial_number, source_type, acquired_date, purchase_price, location_id, holder, quantity, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(categoryId, name.trim(), brand || null, serialNumber || null, sourceType, acquiredDate || null, purchasePrice ?? null, locationId ?? null, holder || null, resolvedQuantity, note || null, auth.username, now).run();
  const newId = insert.meta.last_row_id;

  if (isIndividual) {
    const internalCode = `TS${String(newId).padStart(6, '0')}`;
    await env.DB.prepare(`UPDATE assets SET internal_code = ? WHERE id = ?`).bind(internalCode, newId).run();
  }

  await env.DB.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
     VALUES ('asset_create', 'asset', ?, ?, NULL, ?, ?, ?)`
  ).bind(newId, name.trim(), name.trim(), auth.username, now).run();

  return new Response(JSON.stringify({ id: newId, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
