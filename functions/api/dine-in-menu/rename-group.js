import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_CATEGORIES = ['mon_an', 'do_uong'];

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { category, subgroup, newSubgroup } = body || {};
  if (!VALID_CATEGORIES.includes(category)) return jsonError('Loại món không hợp lệ', 400);
  if (typeof subgroup !== 'string' || subgroup.trim() === '') return jsonError('Thiếu tên nhóm hiện tại', 400);
  if (typeof newSubgroup !== 'string' || newSubgroup.trim() === '') return jsonError('Vui lòng nhập tên nhóm mới', 400);

  const trimmedNew = newSubgroup.trim();
  if (trimmedNew.length > 100) return jsonError('Tên nhóm quá dài', 400);
  if (trimmedNew === subgroup) return jsonError('Tên nhóm mới trùng với tên hiện tại', 400);

  const members = await env.DB.prepare(
    `SELECT MIN(id) AS minId, COUNT(*) AS n FROM dine_in_menu_items WHERE category = ? AND subgroup = ?`
  ).bind(category, subgroup).first();
  if (!members || members.n === 0) return jsonError('Không tìm thấy nhóm', 404);

  const collision = await env.DB.prepare(
    `SELECT 1 FROM dine_in_menu_items WHERE category = ? AND subgroup = ? LIMIT 1`
  ).bind(category, trimmedNew).first();
  if (collision) return jsonError('Tên nhóm đã tồn tại, vui lòng chọn tên khác', 400);

  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`UPDATE dine_in_menu_items SET subgroup = ?, updated_by = ?, updated_at = ? WHERE category = ? AND subgroup = ?`)
      .bind(trimmedNew, auth.username, now, category, subgroup),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('dine_in_menu_item_update', 'dine_in_menu_item', ?, ?, ?, ?, ?, ?)`
    ).bind(
      members.minId,
      `Đổi tên nhóm (${members.n} món)`,
      subgroup,
      trimmedNew,
      auth.username,
      now
    ),
  ]);

  return new Response(JSON.stringify({ ok: true, updated: members.n }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
