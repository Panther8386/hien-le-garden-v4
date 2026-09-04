import { requireAuth } from '../../../lib/requireAuth.js';
import { computeInsertionOrder } from '../../../lib/dineInMenuOrdering.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_CATEGORIES = ['mon_an', 'do_uong'];

function coerceRow(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    price: r.price,
    subgroup: r.subgroup,
    unit: r.unit,
    requiresPreorder: !!r.requires_preorder,
    displayOrder: r.display_order,
    isActive: !!r.is_active,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(`SELECT * FROM dine_in_menu_items ORDER BY category, display_order, id`).all();
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
  const { name, category, price, subgroup, unit, requiresPreorder } = body || {};

  if (typeof name !== 'string' || name.trim() === '') return jsonError('Tên món không được để trống', 400);
  if (name.trim().length > 200) return jsonError('Tên món quá dài', 400);
  if (!VALID_CATEGORIES.includes(category)) return jsonError('Loại món không hợp lệ', 400);
  if (!Number.isInteger(price) || price <= 0) return jsonError('Giá phải là số nguyên lớn hơn 0', 400);
  if (subgroup !== undefined && subgroup !== null && (typeof subgroup !== 'string' || subgroup.length > 100)) return jsonError('Nhóm không hợp lệ', 400);
  if (unit !== undefined && unit !== null && (typeof unit !== 'string' || unit.length > 100)) return jsonError('Đơn vị không hợp lệ', 400);

  const trimmedName = name.trim();
  const trimmedSubgroup = subgroup ? String(subgroup).trim() || null : null;
  const trimmedUnit = unit ? String(unit).trim() || null : null;
  const resolvedPreorder = category === 'mon_an' && requiresPreorder === true;
  const now = new Date().toISOString();

  const { results: existing } = await env.DB.prepare(
    `SELECT id, subgroup FROM dine_in_menu_items WHERE category = ? ORDER BY display_order`
  ).bind(category).all();

  const insert = await env.DB.prepare(
    `INSERT INTO dine_in_menu_items (name, category, price, subgroup, unit, requires_preorder, display_order, is_active, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
  ).bind(trimmedName, category, price, trimmedSubgroup, trimmedUnit, resolvedPreorder ? 1 : 0, auth.username, now).run();
  const newId = insert.meta.last_row_id;

  const orderedIds = computeInsertionOrder(existing, trimmedSubgroup);
  const renumberStatements = orderedIds.map((id, index) =>
    env.DB.prepare(`UPDATE dine_in_menu_items SET display_order = ? WHERE id = ?`).bind(index, id === null ? newId : id)
  );
  await env.DB.batch(renumberStatements);

  await env.DB.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
     VALUES ('dine_in_menu_item_create', 'dine_in_menu_item', ?, ?, NULL, ?, ?, ?)`
  ).bind(newId, trimmedName, `${trimmedName} — ${price.toLocaleString('vi-VN')}đ`, auth.username, now).run();

  const finalDisplayOrder = orderedIds.findIndex((id) => id === null);
  return new Response(
    JSON.stringify({ id: newId, name: trimmedName, category, price, subgroup: trimmedSubgroup, unit: trimmedUnit, requiresPreorder: resolvedPreorder, displayOrder: finalDisplayOrder, isActive: true }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}
