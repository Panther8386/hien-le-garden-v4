import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin']);
  if (auth instanceof Response) return auth;

  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(params.id).first();
  if (!room) {
    return jsonError('Không tìm thấy phòng', 404);
  }

  await env.DB.prepare(`UPDATE rooms SET needs_cleaning = 0, needs_cleaning_since = NULL WHERE id = ?`).bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
