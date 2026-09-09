import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function validate(name, startDate, endDate) {
  if (typeof name !== 'string' || name.trim() === '') return 'Tên ngày lễ không được để trống';
  if (typeof startDate !== 'string' || typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return 'Ngày phải theo định dạng YYYY-MM-DD';
  }
  if (endDate < startDate) return 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu';
  return null;
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM holidays WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy ngày lễ', 404);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  const name = body.name !== undefined ? body.name : existing.name;
  const startDate = body.startDate !== undefined ? body.startDate : existing.start_date;
  const endDate = body.endDate !== undefined ? body.endDate : existing.end_date;

  const error = validate(name, startDate, endDate);
  if (error) return jsonError(error, 400);

  await env.DB.prepare(
    `UPDATE holidays SET name = ?, start_date = ?, end_date = ?, updated_by = ?, updated_at = ? WHERE id = ?`
  ).bind(name, startDate, endDate, auth.username, new Date().toISOString(), params.id).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT id FROM holidays WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy ngày lễ', 404);

  await env.DB.prepare(`DELETE FROM holidays WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
