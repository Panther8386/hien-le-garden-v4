import { requireAuth } from '../../../lib/requireAuth.js';

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
  // `category` is intentionally never read from the request body -- immutable after creation.

  if (typeof name !== 'string' || name.trim() === '') return jsonError('Tên món không được để trống', 400);
  if (name.trim().length > 200) return jsonError('Tên món quá dài', 400);
  if (!Number.isInteger(price) || price <= 0) return jsonError('Giá phải là số nguyên lớn hơn 0', 400);

  const trimmedName = name.trim();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE dine_in_menu_items SET name = ?, price = ?, is_active = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(trimmedName, price, isActive ? 1 : 0, auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('dine_in_menu_item_update', 'dine_in_menu_item', ?, ?, ?, ?, ?, ?)`
    ).bind(
      params.id,
      trimmedName,
      `${existing.name} — ${existing.price.toLocaleString('vi-VN')}đ (${existing.is_active ? 'active' : 'inactive'})`,
      `${trimmedName} — ${price.toLocaleString('vi-VN')}đ (${isActive ? 'active' : 'inactive'})`,
      auth.username,
      now
    ),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
