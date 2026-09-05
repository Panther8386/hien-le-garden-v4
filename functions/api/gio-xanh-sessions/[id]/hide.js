import { requireAuth } from '../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const session = await env.DB.prepare(`SELECT id, status, is_hidden FROM gio_xanh_sessions WHERE id = ?`).bind(params.id).first();
  if (!session) return jsonError('Không tìm thấy phiên', 404);
  if (session.status !== 'closed' && session.status !== 'voided') {
    return jsonError('Chỉ có thể ẩn phiên đã chốt hoặc đã huỷ', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { hidden } = body || {};
  if (typeof hidden !== 'boolean') return jsonError('Thiếu trạng thái ẩn/hiện', 400);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE gio_xanh_sessions SET is_hidden = ? WHERE id = ?`).bind(hidden ? 1 : 0, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('record_hide', 'gio_xanh_session', ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, `Phiên #${params.id}`, session.is_hidden ? 'ẩn' : 'hiện', hidden ? 'ẩn' : 'hiện', auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
