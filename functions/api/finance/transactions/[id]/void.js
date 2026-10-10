// functions/api/finance/transactions/[id]/void.js
import { requireAuth } from '../../../../../lib/requireAuth.js';
import { summarize } from '../index.js';
import { canSeeTransaction } from '../../../../../lib/financeAccess.js';
import { loadCategoryMeta } from '../../../../../lib/financeCategories.js';
import { blockedFinanceLinks, cancelledDepositLink } from '../../../../../lib/financeVoidGuard.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch({ request, env, params }) {
  const auth = await requireAuth(request, env, 'finance.manage');
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing || !canSeeTransaction(auth, existing)) return jsonError('Không tìm thấy giao dịch', 404);
  if (existing.voided_at) return jsonError('Giao dịch này đã được huỷ trước đó', 400);

  const links = await env.DB.prepare(`SELECT (${blockedFinanceLinks}) AS blocked,
    (${cancelledDepositLink}) AS cancelledDeposit FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (links.blocked) return jsonError('Chứng từ đang liên kết nghiệp vụ. Hãy xử lý tại Đặt phòng, Order ăn uống hoặc Giờ Xanh; không huỷ riêng trong Thu chi.', 409);
  const body = await request.json().catch(() => ({}));
  const confirmed = body?.confirmCancelledDeposit === true;
  if (links.cancelledDeposit && !confirmed) return new Response(JSON.stringify({
    code: 'CONFIRM_CANCELLED_DEPOSIT',
    error: 'Khoản thu gắn với cọc của booking đã huỷ. Sau khi huỷ thu, cần vào Lịch sử đặt phòng để xoá cọc đã huỷ thu. Chỉ tiếp tục nếu đây là sửa ghi nhận sai, không phải hoàn tiền cho khách.',
  }), { status: 409, headers: { 'Content-Type': 'application/json' } });

  const now = new Date().toISOString();
  const categoryMeta = await loadCategoryMeta(env);
  const summary = summarize(existing, categoryMeta);

  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ?
      AND voided_at IS NULL AND NOT (${blockedFinanceLinks})
      AND (? = 1 OR NOT (${cancelledDepositLink}))`).bind(auth.username, now, params.id, confirmed ? 1 : 0),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       SELECT 'finance_transaction_void', 'finance_transaction', ?, ?, ?, NULL, ?, ? WHERE changes() > 0`
    ).bind(params.id, summary, summary, auth.username, now),
  ]);
  if (!results[0].meta.changes) return jsonError('Giao dịch hoặc liên kết vừa thay đổi, vui lòng tải lại', 409);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
