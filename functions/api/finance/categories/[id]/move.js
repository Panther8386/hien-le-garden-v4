import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const category = await env.DB.prepare(`SELECT id, type, display_order FROM finance_categories WHERE id = ?`).bind(params.id).first();
  if (!category) return jsonError('Không tìm thấy danh mục', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { direction } = body || {};
  if (direction !== 'up' && direction !== 'down') return jsonError('Hướng di chuyển không hợp lệ', 400);

  const { results: siblings } = await env.DB.prepare(
    `SELECT id, display_order FROM finance_categories WHERE type = ? ORDER BY display_order, id`
  ).bind(category.type).all();

  const index = siblings.findIndex((s) => s.id === category.id);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const target = siblings[targetIndex];
  await env.DB.batch([
    env.DB.prepare(`UPDATE finance_categories SET display_order = ? WHERE id = ?`).bind(target.display_order, category.id),
    env.DB.prepare(`UPDATE finance_categories SET display_order = ? WHERE id = ?`).bind(category.display_order, target.id),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
