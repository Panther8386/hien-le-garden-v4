import { requireAuth } from '../../lib/requireAuth.js';
import { PERMISSION_GROUPS, EDITABLE_ROLES } from '../../lib/permissions.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'users.manage');
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare('SELECT role, permission FROM role_permissions ORDER BY permission').all();
  const roles = Object.fromEntries(EDITABLE_ROLES.map((r) => [r, results.filter((x) => x.role === r).map((x) => x.permission)]));
  return new Response(JSON.stringify({ groups: PERMISSION_GROUPS, roles, canEditRoles: auth.role === 'admin' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
