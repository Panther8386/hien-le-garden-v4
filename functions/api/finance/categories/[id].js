import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_categories WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy danh mục', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  const safeBody = body || {};
  const label = safeBody.label !== undefined ? safeBody.label : existing.label;
  const isActive = safeBody.isActive !== undefined ? safeBody.isActive : !!existing.is_active;
  // `type` and `slug` are intentionally never read from the request body — a
  // category's type and slug are immutable after creation. Silently ignoring rather
  // than erroring keeps a stray extra field in an otherwise-valid request from failing.

  if (typeof label !== 'string' || label.trim() === '') return jsonError('Tên danh mục không được để trống', 400);
  const trimmedLabel = label.trim();

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE finance_categories SET label = ?, is_active = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(trimmedLabel, isActive ? 1 : 0, auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('finance_category_update', 'finance_category', ?, ?, ?, ?, ?, ?)`
    ).bind(
      params.id,
      trimmedLabel,
      `${existing.label} (${existing.is_active ? 'active' : 'inactive'})`,
      `${trimmedLabel} (${isActive ? 'active' : 'inactive'})`,
      auth.username,
      now
    ),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
