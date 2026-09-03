import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTransactions, onRequestPost as createTransaction } from '../functions/api/finance/transactions/index.js';
import { onRequestPatch as patchTransaction } from '../functions/api/finance/transactions/[id].js';
import { onRequestPatch as voidTransaction } from '../functions/api/finance/transactions/[id]/void.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM finance_transactions');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_fin', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_fin', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_fin', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_fin', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('POST /api/finance/transactions', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await createTransaction({ request: new Request('https://x/api/finance/transactions', { method: 'POST' }), env });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', receptionToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 100000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(403);
  });

  it('rejects observer (403)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', observerToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 100000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid type (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'other', category: 'vat_tu', amount: 100000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid category (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'unknown', amount: 100000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-positive amount (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 0, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-integer amount (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 100.5, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed transactionDate (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 100000, transactionDate: '29-08-2026' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid status when provided (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 100000, transactionDate: '2026-08-29', status: 'archived' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('creates a transaction as manager, defaulting status to draft, and writes an audit_log row', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 500000, note: 'Mua phân bón', transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);

    const row = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(body.id).first();
    expect(row.type).toBe('expense');
    expect(row.category).toBe('vat_tu');
    expect(row.amount).toBe(500000);
    expect(row.note).toBe('Mua phân bón');
    expect(row.transaction_date).toBe('2026-08-29');
    expect(row.status).toBe('draft');
    expect(row.created_by).toBe('quan_ly_fin');
    expect(row.voided_at).toBeNull();

    const auditRow = await env.DB.prepare(`SELECT * FROM audit_log WHERE entity_type = 'finance_transaction' AND entity_id = ?`).bind(body.id).first();
    expect(auditRow).not.toBeNull();
    expect(auditRow.action_type).toBe('finance_transaction_create');
    expect(auditRow.actor).toBe('quan_ly_fin');
    expect(auditRow.old_value).toBeNull();
  });

  it('lets admin create with an explicit status', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', adminToken, 'POST', { type: 'income', category: 'ban_hang', amount: 2000000, transactionDate: '2026-08-29', status: 'paid' }),
      env,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT status FROM finance_transactions WHERE id = ?`).bind(body.id).first();
    expect(row.status).toBe('paid');
  });

  it('rejects a type/category mismatch (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'income', category: 'vat_tu', amount: 100000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('accepts a new category (thuc_pham) paired with the correct type (expense)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'thuc_pham', amount: 150000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(201);
  });

  it('rejects a new category (hh_am_thuc_lien_ket, income) paired with the wrong type (400)', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'hh_am_thuc_lien_ket', amount: 150000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('writes the renamed "Lưu trú Hiền Lê" label into the audit_log entry for a dich_vu transaction', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'income', category: 'dich_vu', amount: 700000, transactionDate: '2026-08-29' }),
      env,
    });
    const body = await response.json();
    const auditRow = await env.DB.prepare(`SELECT new_value FROM audit_log WHERE entity_type = 'finance_transaction' AND entity_id = ?`).bind(body.id).first();
    expect(auditRow.new_value).toContain('Lưu trú Hiền Lê');
  });

  it('writes the renamed "Dịch vụ khác" label into the audit_log entry for a ban_hang transaction', async () => {
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'income', category: 'ban_hang', amount: 100000, transactionDate: '2026-09-03' }),
      env,
    });
    const body = await response.json();
    const auditRow = await env.DB.prepare(`SELECT new_value FROM audit_log WHERE entity_type = 'finance_transaction' AND entity_id = ?`).bind(body.id).first();
    expect(auditRow.new_value).toContain('Dịch vụ khác');
  });

  it('rejects create with an inactive category, even though the category itself is otherwise valid (400)', async () => {
    await env.DB.prepare(`UPDATE finance_categories SET is_active = 0 WHERE slug = 'khac'`).run();
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', managerToken, 'POST', { type: 'expense', category: 'khac', amount: 100000, transactionDate: '2026-09-03' }),
      env,
    });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/finance/transactions', () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('expense', 'vat_tu', 100000, 'Vật tư A', '2026-08-01', 'confirmed', 'quan_ly_fin', '2026-08-01T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 3000000, 'Bán rau', '2026-08-15', 'paid', 'admin_fin', '2026-08-15T00:00:00Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, voided_by, voided_at) VALUES ('expense', 'nhan_cong', 200000, 'Công cắt cỏ', '2026-08-20', 'confirmed', 'quan_ly_fin', '2026-08-20T00:00:00Z', 'admin_fin', '2026-08-21T00:00:00Z')`
    ).run();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await listTransactions({ request: new Request('https://x/api/finance/transactions'), env });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', receptionToken, 'GET'), env });
    expect(response.status).toBe(403);
  });

  it('lets observer list (read-only role), but only ever returns income rows — never expense, even voided ones', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body.every((t) => t.type === 'income')).toBe(true);
  });

  it('observer requesting ?type=expense explicitly still gets zero expense rows back (server-side override, not just a UI hint)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?type=expense', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('manager and admin still see both income and expense rows (no regression)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveLength(3);
    expect(body.some((t) => t.type === 'expense')).toBe(true);
  });

  it('includes voided transactions in the list (UI shows them struck-through)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    const voided = body.find((t) => t.note === 'Công cắt cỏ');
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidedBy).toBe('admin_fin');
  });

  it('orders newest transaction_date first', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((t) => t.transactionDate)).toEqual(['2026-08-20', '2026-08-15', '2026-08-01']);
  });

  it('filters by type', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?type=income', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('filters by category', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?category=nhan_cong', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((t) => t.note)).toEqual(['Công cắt cỏ']);
  });

  it('filters by status', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?status=paid', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('filters by date range', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?from=2026-08-10&to=2026-08-16', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('filters by keyword against note, case-insensitively', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?q=rau', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('includes null receipt fields for a transaction with no attachment', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    const row = body.find((t) => t.note === 'Bán rau');
    expect(row.receiptKey).toBeNull();
    expect(row.receiptFilename).toBeNull();
    expect(row.receiptUploadedAt).toBeNull();
  });
});

describe('PATCH /api/finance/transactions/:id', () => {
  let txId;
  beforeEach(async () => {
    const result = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('expense', 'vat_tu', 100000, 'Vật tư gốc', '2026-08-01', 'draft', 'quan_ly_fin', '2026-08-01T00:00:00Z')`
    ).run();
    txId = result.meta.last_row_id;
  });

  it('rejects reception (403)', async () => {
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, receptionToken, 'PATCH', { amount: 150000 }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(403);
  });

  it('rejects observer (403)', async () => {
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, observerToken, 'PATCH', { amount: 150000 }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/999999`, managerToken, 'PATCH', { amount: 150000 }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('partially updates only the given fields, keeping the rest, and stamps updated_by/updated_at', async () => {
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, managerToken, 'PATCH', { amount: 250000, status: 'confirmed' }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(txId).first();
    expect(row.amount).toBe(250000);
    expect(row.status).toBe('confirmed');
    expect(row.category).toBe('vat_tu');
    expect(row.note).toBe('Vật tư gốc');
    expect(row.updated_by).toBe('quan_ly_fin');
    expect(row.updated_at).not.toBeNull();
  });

  it('rejects an invalid amount on update (400)', async () => {
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, managerToken, 'PATCH', { amount: -5 }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a type/category mismatch on update, including when only type changes and category is left stale (400)', async () => {
    // txId starts as expense/vat_tu (see beforeEach) — flipping only type to income
    // must be validated against vat_tu, which is expense-only.
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, managerToken, 'PATCH', { type: 'income' }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(400);
  });

  it('grandfathers a legacy type/category mismatch when the pairing is left unchanged (200)', async () => {
    // Simulates one of the 22 real production rows with type='income', category='khac' —
    // a pairing the current CATEGORY_META table rejects, but which predates pairing
    // enforcement. Editing only amount, leaving type/category untouched, must succeed:
    // the resolved pair is identical to the row's existing pair, so it's not a new choice.
    const legacyResult = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('income', 'khac', 500000, 'Thu nhập cũ', '2026-07-01', 'draft', 'quan_ly_fin', '2026-07-01T00:00:00Z')`
    ).run();
    const legacyTxId = legacyResult.meta.last_row_id;

    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${legacyTxId}`, managerToken, 'PATCH', { amount: 550000 }),
      env,
      params: { id: String(legacyTxId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(legacyTxId).first();
    expect(row.amount).toBe(550000);
    expect(row.type).toBe('income');
    expect(row.category).toBe('khac');
  });

  it('still rejects a genuinely new mismatched pairing on a legacy row (400)', async () => {
    const legacyResult = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('income', 'khac', 500000, 'Thu nhập cũ', '2026-07-01', 'draft', 'quan_ly_fin', '2026-07-01T00:00:00Z')`
    ).run();
    const legacyTxId = legacyResult.meta.last_row_id;

    // Changing category to vat_tu (expense-only) while type stays income is a genuine
    // new choice of pairing, distinct from the row's existing (income, khac) pair —
    // the mismatch check must still fully apply.
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${legacyTxId}`, managerToken, 'PATCH', { category: 'vat_tu' }),
      env,
      params: { id: String(legacyTxId) },
    });
    expect(response.status).toBe(400);
  });

  it('lets an edit succeed on a transaction whose category has since been deactivated, as long as the pairing itself is unchanged', async () => {
    // txId (from this block's beforeEach) starts as expense/vat_tu.
    await env.DB.prepare(`UPDATE finance_categories SET is_active = 0 WHERE slug = 'vat_tu'`).run();
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, managerToken, 'PATCH', { amount: 999000 }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(200);
  });

  it('rejects changing to a now-inactive category, even one of the same type (400)', async () => {
    await env.DB.prepare(`UPDATE finance_categories SET is_active = 0 WHERE slug = 'nhan_cong'`).run();
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, managerToken, 'PATCH', { category: 'nhan_cong' }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(400);
  });

  it('writes an audit_log row with before/after summaries', async () => {
    await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, adminToken, 'PATCH', { amount: 300000 }),
      env,
      params: { id: String(txId) },
    });
    const auditRow = await env.DB.prepare(
      `SELECT * FROM audit_log WHERE entity_type = 'finance_transaction' AND entity_id = ? AND action_type = 'finance_transaction_update'`
    ).bind(txId).first();
    expect(auditRow).not.toBeNull();
    expect(auditRow.old_value).toContain('100.000');
    expect(auditRow.new_value).toContain('300.000');
    expect(auditRow.actor).toBe('admin_fin');
  });

  it('400s when trying to edit an already-voided transaction', async () => {
    await env.DB.prepare(`UPDATE finance_transactions SET voided_by = ?, voided_at = ? WHERE id = ?`).bind('admin_fin', '2026-08-02T00:00:00Z', txId).run();
    const response = await patchTransaction({
      request: authedRequest(`https://x/api/finance/transactions/${txId}`, managerToken, 'PATCH', { amount: 1 }),
      env,
      params: { id: String(txId) },
    });
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/finance/transactions/:id/void', () => {
  let txId;
  beforeEach(async () => {
    const result = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 400000, 'Bán chuối', '2026-08-05', 'confirmed', 'quan_ly_fin', '2026-08-05T00:00:00Z')`
    ).run();
    txId = result.meta.last_row_id;
  });

  it('rejects reception (403)', async () => {
    const response = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${txId}/void`, receptionToken, 'PATCH', {}), env, params: { id: String(txId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/999999/void`, managerToken, 'PATCH', {}), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('voids a transaction, stamping voided_by/voided_at, and writes an audit_log row', async () => {
    const response = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${txId}/void`, adminToken, 'PATCH', {}), env, params: { id: String(txId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).bind(txId).first();
    expect(row.voided_by).toBe('admin_fin');
    expect(row.voided_at).not.toBeNull();
    expect(row.status).toBe('confirmed');

    const auditRow = await env.DB.prepare(
      `SELECT * FROM audit_log WHERE entity_type = 'finance_transaction' AND entity_id = ? AND action_type = 'finance_transaction_void'`
    ).bind(txId).first();
    expect(auditRow).not.toBeNull();
    expect(auditRow.new_value).toBeNull();
  });

  it('400s when voiding an already-voided transaction', async () => {
    await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${txId}/void`, managerToken, 'PATCH', {}), env, params: { id: String(txId) } });
    const response = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${txId}/void`, managerToken, 'PATCH', {}), env, params: { id: String(txId) } });
    expect(response.status).toBe(400);
  });
});
