import { getSession } from './auth.js';

function parseCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function requireAuth(request, env, required) {
  const token = parseCookie(request, 'session');
  const session = token ? await getSession(env.DB, token) : null;

  if (!session) {
    return jsonResponse({ error: 'Chưa đăng nhập' }, 401);
  }
  if (required == null) return session;
  if (Array.isArray(required)) {
    throw new TypeError('requireAuth: dùng mã quyền, không dùng mảng vai trò');
  }
  const allowed = session.permissions.has(required);
  if (!allowed) {
    return jsonResponse({ error: 'Không đủ quyền' }, 403);
  }
  return session;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
