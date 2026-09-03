import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as uploadAttachment, onRequestDelete as deleteAttachment, onRequestGet as getAttachment } from '../functions/api/finance/transactions/[id]/attachment.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, observerToken;
let expenseTxId, incomeTxId, voidedTxId;

function pdfFile(name = 'hoa-don.pdf', bytes = new Uint8Array([1, 2, 3, 4])) {
  return new File([bytes], name, { type: 'application/pdf' });
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM finance_transactions');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_att', 'x', 'manager', '2026-09-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_att', 'x', 'reception', '2026-09-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_att', 'x', 'observer', '2026-09-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const expenseTx = await env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('expense', 'vat_tu', 100000, '2026-09-01', 'draft', 'quan_ly_att', '2026-09-01T00:00:00Z')`
  ).run();
  expenseTxId = expenseTx.meta.last_row_id;

  const incomeTx = await env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 200000, '2026-09-01', 'draft', 'quan_ly_att', '2026-09-01T00:00:00Z')`
  ).run();
  incomeTxId = incomeTx.meta.last_row_id;

  const voidedTx = await env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at, voided_by, voided_at) VALUES ('expense', 'vat_tu', 50000, '2026-09-01', 'draft', 'quan_ly_att', '2026-09-01T00:00:00Z', 'quan_ly_att', '2026-09-01T01:00:00Z')`
  ).run();
  voidedTxId = voidedTx.meta.last_row_id;
});

function authedFormRequest(url, token, file) {
  const form = new FormData();
  if (file) form.append('file', file);
  const headers = {};
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method: 'POST', headers, body: form });
}

function authedRequest(url, token, method) {
  const headers = {};
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers });
}

describe('POST /api/finance/transactions/:id/attachment', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, null, pdfFile()), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, receptionToken, pdfFile()), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(403);
  });

  it('rejects observer (403)', async () => {
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, observerToken, pdfFile()), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent transaction', async () => {
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/999999/attachment`, managerToken, pdfFile()), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('400s for a voided transaction', async () => {
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${voidedTxId}/attachment`, managerToken, pdfFile()), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(400);
  });

  it('400s when no file is included', async () => {
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, null), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(400);
  });

  it('400s for a disallowed content type', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' });
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, file), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(400);
  });

  it('400s for a file over 10MB', async () => {
    const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'hoa-don.pdf', { type: 'application/pdf' });
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, bigFile), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(400);
  });

  it('uploads a valid file, stores the R2 object, updates the transaction row, and writes an audit_log row', async () => {
    const response = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, pdfFile('hoa-don-a.pdf')), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.receiptFilename).toBe('hoa-don-a.pdf');

    const row = await env.DB.prepare(`SELECT receipt_key, receipt_filename, receipt_uploaded_at FROM finance_transactions WHERE id = ?`).bind(expenseTxId).first();
    expect(row.receipt_filename).toBe('hoa-don-a.pdf');
    expect(row.receipt_key).toContain(`finance-receipts/${expenseTxId}/`);
    expect(row.receipt_uploaded_at).not.toBeNull();

    const object = await env.RECEIPTS.get(row.receipt_key);
    expect(object).not.toBeNull();

    const auditRow = await env.DB.prepare(`SELECT * FROM audit_log WHERE entity_type = 'finance_transaction' AND entity_id = ? AND action_type = 'finance_transaction_attachment_upload'`).bind(expenseTxId).first();
    expect(auditRow).not.toBeNull();
    expect(auditRow.actor).toBe('quan_ly_att');
  });

  it('replacing an existing attachment deletes the old R2 object', async () => {
    const first = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, pdfFile('first.pdf')), env, params: { id: String(expenseTxId) } });
    const firstRow = await env.DB.prepare(`SELECT receipt_key FROM finance_transactions WHERE id = ?`).bind(expenseTxId).first();
    expect(first.status).toBe(200);

    await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, pdfFile('second.pdf')), env, params: { id: String(expenseTxId) } });
    const secondRow = await env.DB.prepare(`SELECT receipt_key FROM finance_transactions WHERE id = ?`).bind(expenseTxId).first();

    expect(secondRow.receipt_key).not.toBe(firstRow.receipt_key);
    const oldObject = await env.RECEIPTS.get(firstRow.receipt_key);
    expect(oldObject).toBeNull();
  });
});

describe('DELETE /api/finance/transactions/:id/attachment', () => {
  it('rejects reception (403)', async () => {
    const response = await deleteAttachment({ request: authedRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, receptionToken, 'DELETE'), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(403);
  });

  it('400s when the transaction has no attachment to remove', async () => {
    const response = await deleteAttachment({ request: authedRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, 'DELETE'), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(400);
  });

  it('400s for a voided transaction', async () => {
    const response = await deleteAttachment({ request: authedRequest(`https://x/api/finance/transactions/${voidedTxId}/attachment`, managerToken, 'DELETE'), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(400);
  });

  it('removes the R2 object and clears all three receipt columns', async () => {
    await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, pdfFile()), env, params: { id: String(expenseTxId) } });
    const uploaded = await env.DB.prepare(`SELECT receipt_key FROM finance_transactions WHERE id = ?`).bind(expenseTxId).first();

    const response = await deleteAttachment({ request: authedRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, 'DELETE'), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT receipt_key, receipt_filename, receipt_uploaded_at FROM finance_transactions WHERE id = ?`).bind(expenseTxId).first();
    expect(row).toEqual({ receipt_key: null, receipt_filename: null, receipt_uploaded_at: null });

    const object = await env.RECEIPTS.get(uploaded.receipt_key);
    expect(object).toBeNull();

    const auditRow = await env.DB.prepare(`SELECT * FROM audit_log WHERE entity_type = 'finance_transaction' AND entity_id = ? AND action_type = 'finance_transaction_attachment_delete'`).bind(expenseTxId).first();
    expect(auditRow).not.toBeNull();
  });
});

describe('GET /api/finance/transactions/:id/attachment', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getAttachment({ request: authedRequest(`https://x/api/finance/transactions/${incomeTxId}/attachment`, null, 'GET'), env, params: { id: String(incomeTxId) } });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await getAttachment({ request: authedRequest(`https://x/api/finance/transactions/${incomeTxId}/attachment`, receptionToken, 'GET'), env, params: { id: String(incomeTxId) } });
    expect(response.status).toBe(403);
  });

  it('404s when the transaction has no attachment', async () => {
    const response = await getAttachment({ request: authedRequest(`https://x/api/finance/transactions/${incomeTxId}/attachment`, managerToken, 'GET'), env, params: { id: String(incomeTxId) } });
    expect(response.status).toBe(404);
  });

  it('streams the file back with the right content type and filename for manager/admin', async () => {
    await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, pdfFile('bill.pdf')), env, params: { id: String(expenseTxId) } });
    const response = await getAttachment({ request: authedRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, 'GET'), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toContain('bill.pdf');
  });

  it('observer can fetch an income transaction attachment', async () => {
    await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${incomeTxId}/attachment`, managerToken, pdfFile('income-receipt.pdf')), env, params: { id: String(incomeTxId) } });
    const response = await getAttachment({ request: authedRequest(`https://x/api/finance/transactions/${incomeTxId}/attachment`, observerToken, 'GET'), env, params: { id: String(incomeTxId) } });
    expect(response.status).toBe(200);
  });

  it('observer gets 404 (not 403) for an expense transaction attachment, even though one exists', async () => {
    await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, pdfFile()), env, params: { id: String(expenseTxId) } });
    const response = await getAttachment({ request: authedRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, observerToken, 'GET'), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(404);
  });

  it('produces a safe, well-formed Content-Disposition for a filename with diacritics and a quote character', async () => {
    const trickyName = 'hoá đơn "tháng 9".pdf';
    const uploadResponse = await uploadAttachment({ request: authedFormRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, pdfFile(trickyName)), env, params: { id: String(expenseTxId) } });
    const uploadBody = await uploadResponse.json();
    // The raw quote character in trickyName does not necessarily survive the multipart/form-data
    // round trip verbatim (per the FormData/File spec, a bare `"` in a filename is itself
    // percent-escaped by the multipart encoder) — so assert against whatever filename the server
    // actually stored, not against trickyName's original bytes.
    const storedName = uploadBody.receiptFilename;
    expect(storedName).toContain('hoá đơn');

    const response = await getAttachment({ request: authedRequest(`https://x/api/finance/transactions/${expenseTxId}/attachment`, managerToken, 'GET'), env, params: { id: String(expenseTxId) } });
    expect(response.status).toBe(200);

    const disposition = response.headers.get('Content-Disposition');
    expect(disposition).not.toBeNull();
    expect(disposition.startsWith('inline; filename="')).toBe(true);
    // The quoted fallback filename must not contain a raw quote character (no header injection),
    // and the UTF-8 extended form must round-trip to exactly the stored filename for browsers
    // that support it.
    const quotedMatch = disposition.match(/^inline; filename="([^"]*)"; filename\*=UTF-8''(.+)$/);
    expect(quotedMatch).not.toBeNull();
    expect(quotedMatch[1]).not.toContain('"');
    expect(decodeURIComponent(quotedMatch[2])).toBe(storedName);
  });
});
