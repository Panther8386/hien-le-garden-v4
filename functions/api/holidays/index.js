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

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT id, name, start_date AS startDate, end_date AS endDate FROM holidays ORDER BY start_date`
  ).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
  const { name, startDate, endDate } = body;

  const error = validate(name, startDate, endDate);
  if (error) return jsonError(error, 400);

  await env.DB.prepare(
    `INSERT INTO holidays (name, start_date, end_date, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(name, startDate, endDate, auth.username, new Date().toISOString()).run();

  return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
