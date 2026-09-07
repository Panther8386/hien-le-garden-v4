import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_MANAGEMENT_TYPES = ['infrastructure', 'individual_device', 'device_set', 'durable_goods', 'linen', 'consumable', 'spare_part', 'food_beverage'];

function coerceRow(r) {
  return {
    id: r.id,
    managementType: r.management_type,
    name: r.name,
    defaultUnit: r.default_unit,
    isActive: !!r.is_active,
    displayOrder: r.display_order,
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
  const includeInactive = url.searchParams.get('includeInactive') === '1';
  const where = includeInactive ? '' : 'WHERE is_active = 1';

  const { results } = await env.DB.prepare(
    `SELECT * FROM asset_categories ${where} ORDER BY management_type, display_order, id`
  ).all();

  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { managementType, name, defaultUnit, note } = body || {};

  if (!VALID_MANAGEMENT_TYPES.includes(managementType)) return jsonError('Cách quản lý không hợp lệ', 400);
  if (typeof name !== 'string' || name.trim() === '') return jsonError('Vui lòng nhập tên danh mục', 400);
  if (typeof defaultUnit !== 'string' || defaultUnit.trim() === '') return jsonError('Vui lòng nhập đơn vị tính', 400);

  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO asset_categories (management_type, name, default_unit, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(managementType, name.trim(), defaultUnit.trim(), note || null, auth.username, now).run();
  const newId = insert.meta.last_row_id;

  await env.DB.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
     VALUES ('asset_category_create', 'asset_category', ?, ?, NULL, ?, ?, ?)`
  ).bind(newId, name.trim(), name.trim(), auth.username, now).run();

  return new Response(JSON.stringify({ id: newId, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
