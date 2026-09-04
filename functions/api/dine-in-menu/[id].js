import { requireAuth } from '../../../lib/requireAuth.js';
import { computeInsertionOrder } from '../../../lib/dineInMenuOrdering.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM dine_in_menu_items WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy món', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const safeBody = body || {};
  const name = safeBody.name !== undefined ? safeBody.name : existing.name;
  const price = safeBody.price !== undefined ? safeBody.price : existing.price;
  const isActive = safeBody.isActive !== undefined ? safeBody.isActive : !!existing.is_active;
  const unit = safeBody.unit !== undefined ? safeBody.unit : existing.unit;
  const requiresPreorder = safeBody.requiresPreorder !== undefined ? safeBody.requiresPreorder : !!existing.requires_preorder;
  // `category` is intentionally never read from the request body -- immutable after creation.

  if (typeof name !== 'string' || name.trim() === '') return jsonError('Tên món không được để trống', 400);
  if (name.trim().length > 200) return jsonError('Tên món quá dài', 400);
  if (!Number.isInteger(price) || price <= 0) return jsonError('Giá phải là số nguyên lớn hơn 0', 400);
  if (unit !== undefined && unit !== null && (typeof unit !== 'string' || unit.length > 100)) return jsonError('Đơn vị không hợp lệ', 400);
  if (safeBody.subgroup !== undefined && safeBody.subgroup !== null && (typeof safeBody.subgroup !== 'string' || safeBody.subgroup.length > 100)) return jsonError('Nhóm không hợp lệ', 400);

  const trimmedName = name.trim();
  const trimmedUnit = unit ? String(unit).trim() || null : null;
  const resolvedPreorder = existing.category === 'mon_an' && requiresPreorder === true;
  const now = new Date().toISOString();

  const subgroupChanging = safeBody.subgroup !== undefined && (safeBody.subgroup || null) !== (existing.subgroup || null);
  const trimmedSubgroup = subgroupChanging ? (safeBody.subgroup ? String(safeBody.subgroup).trim() || null : null) : existing.subgroup;

  const statements = [
    env.DB.prepare(`UPDATE dine_in_menu_items SET name = ?, price = ?, is_active = ?, subgroup = ?, unit = ?, requires_preorder = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(trimmedName, price, isActive ? 1 : 0, trimmedSubgroup, trimmedUnit, resolvedPreorder ? 1 : 0, auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('dine_in_menu_item_update', 'dine_in_menu_item', ?, ?, ?, ?, ?, ?)`
    ).bind(
      params.id,
      trimmedName,
      `${existing.name} — ${existing.price.toLocaleString('vi-VN')}đ (${existing.is_active ? 'active' : 'inactive'}) — nhóm: ${existing.subgroup || '(không có)'} — đơn vị: ${existing.unit || '(không có)'} — đặt trước: ${existing.requires_preorder ? 'có' : 'không'}`,
      `${trimmedName} — ${price.toLocaleString('vi-VN')}đ (${isActive ? 'active' : 'inactive'}) — nhóm: ${trimmedSubgroup || '(không có)'} — đơn vị: ${trimmedUnit || '(không có)'} — đặt trước: ${resolvedPreorder ? 'có' : 'không'}`,
      auth.username,
      now
    ),
  ];

  if (subgroupChanging) {
    const { results: siblingsExcludingSelf } = await env.DB.prepare(
      `SELECT id, subgroup FROM dine_in_menu_items WHERE category = ? AND id != ? ORDER BY display_order`
    ).bind(existing.category, params.id).all();
    const orderedIds = computeInsertionOrder(siblingsExcludingSelf, trimmedSubgroup);
    orderedIds.forEach((id, index) => {
      statements.push(
        env.DB.prepare(`UPDATE dine_in_menu_items SET display_order = ? WHERE id = ?`).bind(index, id === null ? params.id : id)
      );
    });
  }

  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
