import { requireAuth } from '../../../lib/requireAuth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, null);
  if (auth instanceof Response) return auth;

  return new Response(JSON.stringify({ username: auth.username, role: auth.role, canManageRoomLayout: auth.canManageRoomLayout }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
