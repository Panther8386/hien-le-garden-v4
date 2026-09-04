import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const item = await env.DB.prepare(`SELECT id, category, subgroup, display_order FROM dine_in_menu_items WHERE id = ?`).bind(params.id).first();
  if (!item) return jsonError('Không tìm thấy món', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { direction } = body || {};
  if (direction !== 'up' && direction !== 'down') return jsonError('Hướng di chuyển không hợp lệ', 400);

  const { results: siblings } = await env.DB.prepare(
    `SELECT id, display_order FROM dine_in_menu_items WHERE category = ? AND (subgroup = ? OR (subgroup IS NULL AND ? IS NULL)) ORDER BY display_order, id`
  ).bind(item.category, item.subgroup, item.subgroup).all();

  const index = siblings.findIndex((s) => s.id === item.id);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const target = siblings[targetIndex];
  await env.DB.batch([
    env.DB.prepare(`UPDATE dine_in_menu_items SET display_order = ? WHERE id = ?`).bind(target.display_order, item.id),
    env.DB.prepare(`UPDATE dine_in_menu_items SET display_order = ? WHERE id = ?`).bind(item.display_order, target.id),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
