// functions/api/finance/transactions/[id]/attachment.js
import { requireAuth } from '../../../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function sanitizeFilename(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
}

function receiptKeyFor(transactionId, filename) {
  return `finance-receipts/${transactionId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy giao dịch', 404);
  if (existing.voided_at) return jsonError('Giao dịch này đã bị huỷ, không thể sửa', 400);

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return jsonError('Vui lòng chọn tệp để tải lên', 400);
  if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
    return jsonError('Chỉ chấp nhận ảnh (JPG/PNG/WebP) hoặc PDF', 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return jsonError('Tệp vượt quá dung lượng tối đa 10MB', 400);
  }

  if (existing.receipt_key) {
    await env.RECEIPTS.delete(existing.receipt_key);
  }

  const key = receiptKeyFor(params.id, file.name);
  await env.RECEIPTS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE finance_transactions SET receipt_key = ?, receipt_filename = ?, receipt_uploaded_at = ? WHERE id = ?`
    ).bind(key, file.name, now, params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('finance_transaction_attachment_upload', 'finance_transaction', ?, ?, NULL, ?, ?, ?)`
    ).bind(params.id, file.name, file.name, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true, receiptFilename: file.name }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing) return jsonError('Không tìm thấy giao dịch', 404);
  if (existing.voided_at) return jsonError('Giao dịch này đã bị huỷ, không thể sửa', 400);
  if (!existing.receipt_key) return jsonError('Giao dịch này chưa có chứng từ đính kèm', 400);

  await env.RECEIPTS.delete(existing.receipt_key);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE finance_transactions SET receipt_key = NULL, receipt_filename = NULL, receipt_uploaded_at = NULL WHERE id = ?`
    ).bind(params.id),
    env.DB.prepare(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
       VALUES ('finance_transaction_attachment_delete', 'finance_transaction', ?, ?, ?, NULL, ?, ?)`
    ).bind(params.id, existing.receipt_filename, existing.receipt_filename, auth.username, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAuth(request, env, ['manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const existing = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(params.id).first();
  if (!existing || !existing.receipt_key) return jsonError('Không tìm thấy chứng từ', 404);
  // Observer's transaction-visibility boundary applies here too: a 403 would itself confirm
  // an attachment exists on an expense transaction this role can't otherwise see — 404 is
  // indistinguishable from "no attachment", same as GET .../transactions already hides
  // expense rows by omission rather than erroring.
  if (auth.role === 'observer' && existing.type !== 'income') {
    return jsonError('Không tìm thấy chứng từ', 404);
  }

  const object = await env.RECEIPTS.get(existing.receipt_key);
  if (!object) return jsonError('Không tìm thấy chứng từ', 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${existing.receipt_filename || 'chung-tu'}"`);
  return new Response(object.body, { status: 200, headers });
}
