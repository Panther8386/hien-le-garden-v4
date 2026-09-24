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
  // Tạm thời: API chưa chuyển vẫn truyền mảng vai trò. Task 11 bỏ nhánh này.
  const allowed = Array.isArray(required) ? required.includes(session.role) : session.permissions.has(required);
  if (!allowed) {
    return jsonResponse({ error: 'Không đủ quyền' }, 403);
  }
  return session;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
