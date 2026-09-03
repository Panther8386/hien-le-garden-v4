import { requireAuth } from '../../../../lib/requireAuth.js';
import { summarize } from './index.js';
import { VALID_CATEGORIES, categoryMatchesType } from '../../../../lib/financeCategories.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_TYPES = ['income', 'expense'];
const VALID_STATUSES = ['draft', 'confirmed', 'paid'];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy giao dịch', 404);
  if (existing.voided_at) return jsonError('Giao dịch này đã bị huỷ, không thể sửa', 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }

  const type = body.type !== undefined ? body.type : existing.type;
  const category = body.category !== undefined ? body.category : existing.category;
  const amount = body.amount !== undefined ? body.amount : existing.amount;
  const note = body.note !== undefined ? body.note : existing.note;
  const transactionDate = body.transactionDate !== undefined ? body.transactionDate : existing.transaction_date;
  const status = body.status !== undefined ? body.status : existing.status;

  if (!VALID_TYPES.includes(type)) return jsonError('Loại giao dịch không hợp lệ', 400);
  if (!VALID_CATEGORIES.includes(category)) return jsonError('Danh mục không hợp lệ', 400);
  if (!categoryMatchesType(category, type)) return jsonError('Danh mục không phù hợp với loại giao dịch đã chọn', 400);
  if (!Number.isInteger(amount) || amount <= 0) return jsonError('Số tiền phải là số nguyên dương', 400);
  if (typeof transactionDate !== 'string' || !DATE_FORMAT.test(transactionDate)) return jsonError('Ngày không hợp lệ', 400);
  if (!VALID_STATUSES.includes(status)) return jsonError('Trạng thái không hợp lệ', 400);

  const now = new Date().toISOString();
  const oldSummary = summarize(existing);
  const newSummary = summarize({ type, category, amount });

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE finance_transactions SET type = ?, category = ?, amount = ?, note = ?, transaction_date = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(type, category, amount, note || null, transactionDate, status, auth.username, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('finance_transaction_update', 'finance_transaction', ?, ?, ?, ?, ?, ?)`
    ).bind(params.id, newSummary, oldSummary, newSummary, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
