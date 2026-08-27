import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  if (String(auth.staffId) === params.id) {
    return jsonError('Không thể tự xoá tài khoản của chính mình', 400);
  }

  const target = await env.DB.prepare(`SELECT id FROM staff_accounts WHERE id = ?`).bind(params.id).first();
  if (!target) {
    return jsonError('Không tìm thấy tài khoản', 404);
  }

  await env.DB.prepare(`DELETE FROM staff_accounts WHERE id = ?`).bind(params.id).run();
  return new Response(null, { status: 204 });
}
