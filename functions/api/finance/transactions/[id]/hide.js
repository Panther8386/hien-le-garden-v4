import { requireAuth } from '../../../../../lib/requireAuth.js';
import { summarize } from '../index.js';
import { loadCategoryMeta } from '../../../../../lib/financeCategories.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy giao dịch', 404);
  if (!existing.voided_at) return jsonError('Chỉ có thể ẩn giao dịch đã huỷ', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { hidden } = body || {};
  if (typeof hidden !== 'boolean') return jsonError('Thiếu trạng thái ẩn/hiện', 400);

  const categoryMeta = await loadCategoryMeta(env);
  const summary = summarize(existing, categoryMeta);
  const entityLabel = existing.note ? `${summary} — ${existing.note}` : summary;
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`UPDATE finance_transactions SET is_hidden = ? WHERE id = ?`).bind(hidden ? 1 : 0, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('record_hide', 'finance_transaction', ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, entityLabel, existing.is_hidden ? 'ẩn' : 'hiện', hidden ? 'ẩn' : 'hiện', auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
