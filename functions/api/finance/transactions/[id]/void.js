// functions/api/finance/transactions/[id]/void.js
import { requireAuth } from '../../../../../lib/requireAuth.js';
import { summarize } from '../index.js';
import { loadCategoryMeta } from '../../../../../lib/financeCategories.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy giao dịch', 404);
  if (existing.voided_at) return jsonError('Giao dịch này đã được huỷ trước đó', 400);

  const now = new Date().toISOString();
  const categoryMeta = await loadCategoryMeta(env);
  const summary = summarize(existing, categoryMeta);

  await env.DB.batch([
    env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ?`).bind(auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('finance_transaction_void', 'finance_transaction', ?, ?, ?, NULL, ?, ?)`
    ).bind(params.id, summary, summary, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
