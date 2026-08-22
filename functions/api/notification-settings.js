import { requireAuth } from '../../lib/requireAuth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager']);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(`SELECT booking_notify_chat_id FROM notification_settings ORDER BY id DESC LIMIT 1`).first();

  return new Response(JSON.stringify({ connected: !!row }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
