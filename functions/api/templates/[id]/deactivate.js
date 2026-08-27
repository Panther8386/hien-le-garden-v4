import { requireAuth } from '../../../../lib/requireAuth.js';

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const template = await env.DB.prepare(`SELECT id FROM message_templates WHERE id = ?`).bind(params.id).first();
  if (!template) {
    return new Response(JSON.stringify({ error: 'Không tìm thấy template' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare(`UPDATE message_templates SET is_active = 0 WHERE id = ?`).bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
