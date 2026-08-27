import { requireAuth } from '../../../lib/requireAuth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['reception', 'manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get('limit'), 10);
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 5;

  const { results } = await env.DB.prepare(
    `SELECT changed_by AS changedBy, changed_at AS changedAt FROM room_layout_log ORDER BY id DESC LIMIT ?`
  ).bind(limit).all();

  return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
