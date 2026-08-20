import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT id FROM message_templates WHERE id = ?`).bind(params.id).first();
  if (!existing) {
    return jsonError('Không tìm thấy template', 404);
  }

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

  await env.DB.prepare(
    `UPDATE message_templates SET name = ?, channel = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?`
  )
    .bind(name, channel, channel === 'email' ? subject : null, templateBody, new Date().toISOString(), params.id)
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT is_active FROM message_templates WHERE id = ?`).bind(params.id).first();
  if (!existing) {
    return jsonError('Không tìm thấy template', 404);
  }
  if (existing.is_active) {
    return jsonError('Không thể xoá template đang active — hãy chuyển active sang template khác trước', 400);
  }

  await env.DB.prepare(`DELETE FROM message_templates WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
