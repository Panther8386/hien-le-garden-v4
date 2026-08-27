import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    `SELECT id, name, channel, subject, body, is_active AS isActive, updated_at AS updatedAt
     FROM message_templates ORDER BY channel, name`
  ).all();

  const coerced = results.map((r) => ({ ...r, isActive: !!r.isActive }));
  return new Response(JSON.stringify(coerced), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { name, channel, subject, body: templateBody } = body;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return jsonError('Tên template không được để trống', 400);
  }
  if (channel !== 'email' && channel !== 'telegram') {
    return jsonError('Kênh phải là email hoặc telegram', 400);
  }
  if (channel === 'email' && (typeof subject !== 'string' || subject.trim().length === 0)) {
    return jsonError('Template email cần tiêu đề', 400);
  }
  if (typeof templateBody !== 'string' || templateBody.trim().length === 0) {
    return jsonError('Nội dung template không được để trống', 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO message_templates (name, channel, subject, body, is_active, created_by, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(name, channel, channel === 'email' ? subject : null, templateBody, auth.username, new Date().toISOString())
    .run();

  return new Response(JSON.stringify({ id: result.meta.last_row_id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
