import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTransactions, onRequestPost as createTransaction } from '../functions/api/finance/transactions/index.js';
import { onRequestPatch as patchTransaction } from '../functions/api/finance/transactions/[id].js';
import { onRequestPatch as voidTransaction } from '../functions/api/finance/transactions/[id]/void.js';
import { onRequestPatch as hideTransaction } from '../functions/api/finance/transactions/[id]/hide.js';
import { createSession } from '../lib/auth.js';
import { setOverride } from './helpers/permissions.js';
import { envWithHookBefore } from './helpers/raceEnv.js';

let managerToken, receptionToken, adminToken, observerToken;
let managerStaffId;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM finance_transactions');
  await env.DB.exec('DELETE FROM audit_log');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_fin', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_fin', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_fin', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_fin', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerStaffId = m.meta.last_row_id;
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

  it('lets a reception account with the finance.create override create a transaction', async () => {
    const granted = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_duoc_cap', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
    await setOverride(env.DB, granted.meta.last_row_id, 'finance.create');
    const grantedToken = await createSession(env.DB, granted.meta.last_row_id);
    const response = await createTransaction({
      request: authedRequest('https://x/api/finance/transactions', grantedToken, 'POST', { type: 'expense', category: 'vat_tu', amount: 100000, transactionDate: '2026-08-29' }),
      env,
    });
    expect(response.status).toBe(201);
  });

  it('rejects an observer without an explicit grant (403)', async () => {
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

  it('lets observer see only income ("Thu") rows, ignoring any expense/voided rows', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe('income');
    expect(body.transactions[0].note).toBe('Bán rau');
  });

  it('forces type=income for observer even when the client explicitly requests type=expense', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?type=expense', observerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe('income');
  });

  it('gives observer sumIncome but a permanently-zero sumExpense and income-only categoryTotals/chartRows', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', observerToken, 'GET'), env });
    const body = await response.json();
    expect(body.sumIncome).toBe(3000000);
    expect(body.sumExpense).toBe(0);
    expect(Object.keys(body.categoryTotals)).toEqual(['ban_hang']);
    expect(body.chartRows).toHaveLength(1);
    expect(body.chartRows[0].type).toBe('income');
  });

  it('manager and admin still see both income and expense rows (no regression)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions).toHaveLength(3);
    expect(body.transactions.some((t) => t.type === 'expense')).toBe(true);
  });

  it('override: grants finance.view_income to a reception account, who then sees only income rows', async () => {
    const granted = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_xem_thu', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
    await setOverride(env.DB, granted.meta.last_row_id, 'finance.view_income');
    const grantedToken = await createSession(env.DB, granted.meta.last_row_id);
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', grantedToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe('income');
  });

  it('override: denies finance.view_all from manager, forcing income-only results despite the role default', async () => {
    await setOverride(env.DB, managerStaffId, 'finance.view_all', 'deny');
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe('income');
  });

  it('includes voided transactions in the list (UI shows them struck-through)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    const voided = body.transactions.find((t) => t.note === 'Công cắt cỏ');
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidedBy).toBe('admin_fin');
  });

  it('orders newest transaction_date first', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.map((t) => t.transactionDate)).toEqual(['2026-08-20', '2026-08-15', '2026-08-01']);
  });

  it('filters by type', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?type=income', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('filters by category', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?category=nhan_cong', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.map((t) => t.note)).toEqual(['Công cắt cỏ']);
  });

  it('filters by status', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?status=paid', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('filters by date range', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?from=2026-08-10&to=2026-08-16', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('filters by keyword against note, case-insensitively', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?q=rau', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.map((t) => t.note)).toEqual(['Bán rau']);
  });

  it('includes null receipt fields for a transaction with no attachment', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    const row = body.transactions.find((t) => t.note === 'Bán rau');
    expect(row.receiptKey).toBeNull();
    expect(row.receiptFilename).toBeNull();
    expect(row.receiptUploadedAt).toBeNull();
  });

  it('rejects an invalid pageSize (400)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?pageSize=7', managerToken, 'GET'), env });
    expect(response.status).toBe(400);
  });

  it('defaults to page=1, pageSize=25 when omitted', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.transactions).toHaveLength(3);
  });

  it('paginates with pageSize=10 across multiple pages, keeping total/sums stable regardless of page', async () => {
    for (let i = 0; i < 12; i += 1) {
      await env.DB.prepare(
        `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('income', 'ban_hang', 100000, ?, ?, 'paid', 'admin_fin', '2026-08-05T00:00:00Z')`
      ).bind(`Extra ${i}`, `2026-08-0${(i % 9) + 1}`).run();
    }
    const page1Response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?pageSize=10&page=1', managerToken, 'GET'), env });
    const page1 = await page1Response.json();
    expect(page1.transactions).toHaveLength(10);
    expect(page1.total).toBe(15);

    const page2Response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?pageSize=10&page=2', managerToken, 'GET'), env });
    const page2 = await page2Response.json();
    expect(page2.transactions).toHaveLength(5);
    expect(page2.total).toBe(15);
    expect(page2.sumIncome).toBe(page1.sumIncome);
  });

  it('computes sumIncome/sumExpense over the full filtered set, excluding drafts and voided rows', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    // beforeEach seeds: income/ban_hang/3000000 (paid, not voided) — counts;
    // expense/vat_tu/100000 (confirmed, not voided) — counts;
    // expense/nhan_cong/200000 (confirmed, but VOIDED) — excluded.
    expect(body.sumIncome).toBe(3000000);
    expect(body.sumExpense).toBe(100000);
    // The raw list itself is unaffected — all 3 rows still appear.
    expect(body.transactions).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  it('computes categoryTotals grouped by category and type, excluding a voided row entirely', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.categoryTotals.vat_tu).toEqual({ income: 0, expense: 100000 });
    expect(body.categoryTotals.ban_hang).toEqual({ income: 3000000, expense: 0 });
    // nhan_cong's only transaction is voided — it never enters categoryTotals.
    expect(body.categoryTotals.nhan_cong).toBeUndefined();
  });

  it('returns chartRows with exactly transactionDate/type/amount/status/voidedAt for every filtered row', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.chartRows).toHaveLength(3);
    expect(Object.keys(body.chartRows[0]).sort()).toEqual(['amount', 'status', 'transactionDate', 'type', 'voidedAt']);
  });

  it('excludes hidden transactions by default', async () => {
    await env.DB.prepare(`UPDATE finance_transactions SET is_hidden = 1 WHERE note = 'Công cắt cỏ'`).run();
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.map((t) => t.note)).not.toContain('Công cắt cỏ');
    expect(body.total).toBe(2);
  });

  it('includeHidden=1 has no effect for a non-admin role', async () => {
    await env.DB.prepare(`UPDATE finance_transactions SET is_hidden = 1 WHERE note = 'Công cắt cỏ'`).run();
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?includeHidden=1', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.total).toBe(2);
  });

  it('includeHidden=1 as admin includes hidden transactions', async () => {
    await env.DB.prepare(`UPDATE finance_transactions SET is_hidden = 1 WHERE note = 'Công cắt cỏ'`).run();
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions?includeHidden=1', adminToken, 'GET'), env });
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.transactions.map((t) => t.note)).toContain('Công cắt cỏ');
  });

  it('response includes isHidden as a real boolean on every row', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.transactions.every((t) => typeof t.isHidden === 'boolean')).toBe(true);
  });
});

describe('PATCH /api/finance/transactions/:id/hide', () => {
  let voidedTxId, activeTxId;

  beforeEach(async () => {
    const voided = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, voided_by, voided_at) VALUES ('expense', 'vat_tu', 50000, 'Nhập nhầm', '2026-08-22', 'confirmed', 'quan_ly_fin', '2026-08-22T00:00:00Z', 'admin_fin', '2026-08-23T00:00:00Z')`
    ).run();
    voidedTxId = voided.meta.last_row_id;
    const active = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at) VALUES ('expense', 'vat_tu', 60000, 'Còn hiệu lực', '2026-08-24', 'confirmed', 'quan_ly_fin', '2026-08-24T00:00:00Z')`
    ).run();
    activeTxId = active.meta.last_row_id;
  });

  it('rejects unauthenticated requests', async () => {
    const response = await hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${voidedTxId}/hide`, null, 'PATCH', { hidden: true }), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(401);
  });

  it('rejects manager (403) — hide is admin-only', async () => {
    const response = await hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${voidedTxId}/hide`, managerToken, 'PATCH', { hidden: true }), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(403);
  });

  it('rejects reception (403)', async () => {
    const response = await hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${voidedTxId}/hide`, receptionToken, 'PATCH', { hidden: true }), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await hideTransaction({ request: authedRequest('https://x/api/finance/transactions/999999/hide', adminToken, 'PATCH', { hidden: true }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('400s when the transaction has not been voided', async () => {
    const response = await hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${activeTxId}/hide`, adminToken, 'PATCH', { hidden: true }), env, params: { id: String(activeTxId) } });
    expect(response.status).toBe(400);
  });

  it('400s when hidden is missing or not a boolean', async () => {
    const response = await hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${voidedTxId}/hide`, adminToken, 'PATCH', {}), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(400);
  });

  it('hides a voided transaction and writes an audit_log row using summarize()', async () => {
    const response = await hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${voidedTxId}/hide`, adminToken, 'PATCH', { hidden: true }), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT is_hidden FROM finance_transactions WHERE id = ?`).bind(voidedTxId).first();
    expect(row.is_hidden).toBe(1);
    const audit = await env.DB.prepare(`SELECT * FROM audit_log WHERE action_type = 'record_hide' AND entity_id = ?`).bind(voidedTxId).first();
    expect(audit.entity_type).toBe('finance_transaction');
    expect(audit.entity_label).toContain('Nhập nhầm');
    expect(audit.new_value).toBe('ẩn');
  });

  it('unhides a hidden transaction', async () => {
    await env.DB.prepare(`UPDATE finance_transactions SET is_hidden = 1 WHERE id = ?`).bind(voidedTxId).run();
    const response = await hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${voidedTxId}/hide`, adminToken, 'PATCH', { hidden: false }), env, params: { id: String(voidedTxId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT is_hidden FROM finance_transactions WHERE id = ?`).bind(voidedTxId).first();
    expect(row.is_hidden).toBe(0);
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

  async function booking(status = 'cancelled') {
    const row = await env.DB.prepare(`INSERT INTO bookings
      (guest_name, phone, room_type, check_in, check_out, status, source, created_at)
      VALUES ('Fixture', '000', 'circle', '2099-01-01', '2099-01-02', ?, 'website', '2026-08-01')`).bind(status).run();
    return row.meta.last_row_id;
  }

  async function attempt(body = {}) {
    return voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${txId}/void`, adminToken, 'PATCH', body), env, params: { id: String(txId) } });
  }

  async function expectUnchanged() {
    expect((await env.DB.prepare('SELECT voided_at FROM finance_transactions WHERE id = ?').bind(txId).first()).voided_at).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'finance_transaction_void'").first()).n).toBe(0);
  }

  it('blocks checkout receipts even with a confirmation flag, without an audit or money change', async () => {
    const id = await booking('checked_out');
    await env.DB.prepare('UPDATE finance_transactions SET checkout_booking_id = ? WHERE id = ?').bind(id, txId).run();
    expect((await attempt({ confirmCancelledDeposit: true })).status).toBe(409);
    await expectUnchanged();
  });

  it('protects legacy atomic checkout receipts using exact audit provenance without linking manual income', async () => {
    const row = await env.DB.prepare('SELECT created_at, created_by FROM finance_transactions WHERE id = ?').bind(txId).first();
    await env.DB.prepare(`UPDATE finance_transactions SET category = 'dich_vu', note = 'Tiền phòng — Fixture' WHERE id = ?`).bind(txId).run();
    await env.DB.prepare(`INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, new_value, actor, created_at)
      VALUES ('booking_checkout', 'booking', 123, 'Fixture', ?, ?, ?)`).bind(JSON.stringify({ roomDue: 400000 }), row.created_by, row.created_at).run();
    expect((await attempt()).status).toBe(409);
    await expectUnchanged();
    await env.DB.prepare(`UPDATE finance_transactions SET created_at = '2026-08-06T00:00:00Z' WHERE id = ?`).bind(txId).run();
    expect((await attempt()).status).toBe(200);
  });

  it('requires explicit confirmation for a cancelled unrefunded deposit and preserves the deposit until reconciliation', async () => {
    const id = await booking();
    await env.DB.prepare(`INSERT INTO booking_deposits (booking_id, amount, payment_method, finance_transaction_id, created_by, created_at)
      VALUES (?, 400000, 'cash', ?, 'fixture', '2026-08-01')`).bind(id, txId).run();
    const denied = await attempt();
    expect(denied.status).toBe(409);
    expect((await denied.json()).code).toBe('CONFIRM_CANCELLED_DEPOSIT');
    await expectUnchanged();
    expect((await attempt({ confirmCancelledDeposit: true })).status).toBe(200);
    expect((await env.DB.prepare('SELECT voided_at FROM booking_deposits WHERE booking_id = ?').bind(id).first()).voided_at).toBeNull();
  });

  it('blocks a deposit after the booking changes to a live state despite stale confirmation', async () => {
    const id = await booking('confirmed');
    await env.DB.prepare(`INSERT INTO booking_deposits (booking_id, amount, payment_method, finance_transaction_id, created_by, created_at)
      VALUES (?, 400000, 'cash', ?, 'fixture', '2026-08-01')`).bind(id, txId).run();
    expect((await attempt({ confirmCancelledDeposit: true })).status).toBe(409);
    await expectUnchanged();
  });

  it('blocks linked order receipts', async () => {
    await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at, finance_transaction_id)
      VALUES ('fixture', 'closed', 'fixture', '2026-08-01', ?)`).bind(txId).run();
    expect((await attempt()).status).toBe(409);
    await expectUnchanged();
  });

  it('rejects a new order link inserted after preflight without writing a void audit', async () => {
    const raced = envWithHookBefore(/UPDATE finance_transactions SET voided_by/, async () => {
      await env.DB.prepare(`INSERT INTO dine_in_orders (table_label, status, opened_by, opened_at, finance_transaction_id)
        VALUES ('race', 'closed', 'fixture', '2026-08-01', ?)`).bind(txId).run();
    });
    const response = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${txId}/void`, adminToken, 'PATCH', {}), env: raced, params: { id: String(txId) } });
    expect(response.status).toBe(409);
    await expectUnchanged();
  });

  it('blocks Giờ Xanh receipts', async () => {
    const room = await env.DB.prepare('SELECT id FROM rooms LIMIT 1').first();
    await env.DB.prepare(`INSERT INTO gio_xanh_sessions (room_id, guest_name, status, opened_by, opened_at, finance_transaction_id)
      VALUES (?, 'fixture', 'closed', 'fixture', '2026-08-01', ?)`).bind(room.id, txId).run();
    expect((await attempt()).status).toBe(409);
    await expectUnchanged();
  });

  it('blocks service and refund receipts even after their parent is cancelled', async () => {
    const id = await booking();
    await env.DB.prepare(`INSERT INTO booking_service_items
      (booking_id, name, unit_price, quantity, amount, created_at, finance_transaction_id)
      VALUES (?, 'fixture', 400000, 1, 400000, '2026-08-01', ?)`).bind(id, txId).run();
    expect((await attempt()).status).toBe(409);
    await expectUnchanged();
    await env.DB.prepare('UPDATE booking_service_items SET finance_transaction_id = NULL WHERE booking_id = ?').bind(id).run();
    await env.DB.prepare('UPDATE bookings SET refund_finance_transaction_id = ? WHERE id = ?').bind(txId, id).run();
    expect((await attempt()).status).toBe(409);
    await expectUnchanged();
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

describe('finance.manage without finance.view_all only reaches visible income rows', () => {
  async function seed(type, hidden = 0) {
    const r = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at, is_hidden) VALUES (?, ?, 100000, '2026-09-01', 'draft', 'quan_ly_fin', '2026-09-01T00:00:00Z', ?)`
    ).bind(type, type === 'income' ? 'ban_hang' : 'vat_tu', hidden).run();
    return String(r.meta.last_row_id);
  }
  beforeEach(async () => {
    await setOverride(env.DB, managerStaffId, 'finance.view_all', 'deny');
  });

  it('PATCH 404s on an expense and on a hidden income, leaving them unchanged; works on a visible income', async () => {
    const expenseId = await seed('expense');
    const hiddenId = await seed('income', 1);
    const incomeId = await seed('income');
    for (const id of [expenseId, hiddenId]) {
      const res = await patchTransaction({ request: authedRequest(`https://x/api/finance/transactions/${id}`, managerToken, 'PATCH', { amount: 999000 }), env, params: { id } });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Không tìm thấy giao dịch');
      expect((await env.DB.prepare('SELECT amount FROM finance_transactions WHERE id = ?').bind(id).first()).amount).toBe(100000);
    }
    const ok = await patchTransaction({ request: authedRequest(`https://x/api/finance/transactions/${incomeId}`, managerToken, 'PATCH', { amount: 999000 }), env, params: { id: incomeId } });
    expect(ok.status).toBe(200);
  });

  it('void 404s on an expense and on a hidden income; works on a visible income', async () => {
    const expenseId = await seed('expense');
    const hiddenId = await seed('income', 1);
    const incomeId = await seed('income');
    for (const id of [expenseId, hiddenId]) {
      const res = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${id}/void`, managerToken, 'PATCH'), env, params: { id } });
      expect(res.status).toBe(404);
      expect((await env.DB.prepare('SELECT voided_at FROM finance_transactions WHERE id = ?').bind(id).first()).voided_at).toBeNull();
    }
    const ok = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${incomeId}/void`, managerToken, 'PATCH'), env, params: { id: incomeId } });
    expect(ok.status).toBe(200);
  });
});

describe('PATCH type change authorization', () => {
  async function seed(type) {
    const r = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at) VALUES (?, ?, 100000, '2026-09-01', 'draft', 'quan_ly_fin', '2026-09-01T00:00:00Z')`
    ).bind(type, type === 'income' ? 'ban_hang' : 'vat_tu').run();
    return String(r.meta.last_row_id);
  }
  async function patchAs(token, id, body) {
    return patchTransaction({ request: authedRequest(`https://x/api/finance/transactions/${id}`, token, 'PATCH', body), env, params: { id } });
  }
  async function rowOf(id) {
    return env.DB.prepare('SELECT type, category, amount FROM finance_transactions WHERE id = ?').bind(id).first();
  }
  // FULL = manager as seeded (finance.manage + finance.view_all).
  // NO_ALL = same manager with finance.view_all denied (keeps finance.manage + finance.view_income).
  async function denyViewAll() {
    await setOverride(env.DB, managerStaffId, 'finance.view_all', 'deny');
  }

  it('1. income → income (amount change): FULL 200', async () => {
    const id = await seed('income');
    const res = await patchAs(managerToken, id, { amount: 222000 });
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toEqual({ type: 'income', category: 'ban_hang', amount: 222000 });
  });

  it('1. income → income (amount change): NO_ALL 200', async () => {
    await denyViewAll();
    const id = await seed('income');
    const res = await patchAs(managerToken, id, { amount: 222000 });
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toEqual({ type: 'income', category: 'ban_hang', amount: 222000 });
  });

  it('2. expense → expense: FULL 200', async () => {
    const id = await seed('expense');
    const res = await patchAs(managerToken, id, { amount: 333000 });
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toEqual({ type: 'expense', category: 'vat_tu', amount: 333000 });
  });

  it('2. expense → expense: NO_ALL 404 (source not visible), row unchanged', async () => {
    await denyViewAll();
    const id = await seed('expense');
    const res = await patchAs(managerToken, id, { amount: 333000 });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Không tìm thấy giao dịch');
    expect(await rowOf(id)).toEqual({ type: 'expense', category: 'vat_tu', amount: 100000 });
  });

  it('3. income → expense: FULL 200 with a valid expense category', async () => {
    const id = await seed('income');
    const res = await patchAs(managerToken, id, { type: 'expense', category: 'vat_tu' });
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toEqual({ type: 'expense', category: 'vat_tu', amount: 100000 });
  });

  it('3. income → expense: NO_ALL 403 (destination not visible), row unchanged, no audit', async () => {
    await denyViewAll();
    const id = await seed('income');
    const res = await patchAs(managerToken, id, { type: 'expense', category: 'vat_tu', amount: 444000 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Không đủ quyền đổi giao dịch sang loại này');
    expect(await rowOf(id)).toEqual({ type: 'income', category: 'ban_hang', amount: 100000 });
    const audit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?`).bind(id).first();
    expect(audit.n).toBe(0);
  });

  it('4. expense → income: FULL 200', async () => {
    const id = await seed('expense');
    const res = await patchAs(managerToken, id, { type: 'income', category: 'ban_hang' });
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toEqual({ type: 'income', category: 'ban_hang', amount: 100000 });
  });

  it('4. expense → income: NO_ALL 404 (source not visible), row unchanged', async () => {
    await denyViewAll();
    const id = await seed('expense');
    const res = await patchAs(managerToken, id, { type: 'income', category: 'ban_hang' });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Không tìm thấy giao dịch');
    expect(await rowOf(id)).toEqual({ type: 'expense', category: 'vat_tu', amount: 100000 });
  });

  it('5. reception (no finance.manage) → 403 on any PATCH, rows unchanged', async () => {
    const incomeId = await seed('income');
    const expenseId = await seed('expense');
    for (const [id, body] of [[incomeId, { amount: 555000 }], [incomeId, { type: 'expense', category: 'vat_tu' }], [expenseId, { type: 'income', category: 'ban_hang' }]]) {
      const res = await patchAs(receptionToken, id, body);
      expect(res.status).toBe(403);
    }
    expect(await rowOf(incomeId)).toEqual({ type: 'income', category: 'ban_hang', amount: 100000 });
    expect(await rowOf(expenseId)).toEqual({ type: 'expense', category: 'vat_tu', amount: 100000 });
  });
});

describe('PATCH /api/finance/transactions/:id/hide — records.hide does not imply finance visibility', () => {
  // manager granted records.hide; finance.view_all denied where the test needs it.
  async function seed(type, hidden = 0, voided = true) {
    const r = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at, is_hidden, voided_by, voided_at) VALUES (?, ?, 100000, '2026-09-01', 'confirmed', 'quan_ly_fin', '2026-09-01T00:00:00Z', ?, ?, ?)`
    ).bind(type, type === 'income' ? 'ban_hang' : 'vat_tu', hidden, voided ? 'admin_fin' : null, voided ? '2026-09-02T00:00:00Z' : null).run();
    return String(r.meta.last_row_id);
  }
  const hide = (id, hidden = true) => hideTransaction({ request: authedRequest(`https://x/api/finance/transactions/${id}/hide`, managerToken, 'PATCH', { hidden }), env, params: { id } });
  const hiddenOf = async (id) => (await env.DB.prepare('SELECT is_hidden FROM finance_transactions WHERE id = ?').bind(id).first()).is_hidden;

  beforeEach(async () => {
    await setOverride(env.DB, managerStaffId, 'records.hide', 'grant');
  });

  it('answers an invisible existing id exactly like a non-existent one (404, same body), is_hidden unchanged', async () => {
    await setOverride(env.DB, managerStaffId, 'finance.view_all', 'deny');
    const voidedExpense = await seed('expense');
    const activeExpense = await seed('expense', 0, false); // visibility check runs before the voided check
    const hiddenIncome = await seed('income', 1);
    const missing = await hide('999999');
    const missingBody = await missing.json();
    expect(missing.status).toBe(404);
    expect(missingBody).toEqual({ error: 'Không tìm thấy giao dịch' });
    for (const [id, hidden] of [[voidedExpense, true], [activeExpense, true], [hiddenIncome, false]]) {
      const res = await hide(id, hidden);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(missingBody);
    }
    expect(await hiddenOf(voidedExpense)).toBe(0);
    expect(await hiddenOf(activeExpense)).toBe(0);
    expect(await hiddenOf(hiddenIncome)).toBe(1);
  });

  it('without view_all: can hide a voided income row, then gets 404 trying to unhide it', async () => {
    await setOverride(env.DB, managerStaffId, 'finance.view_all', 'deny');
    const id = await seed('income');
    const res = await hide(id, true);
    expect(res.status).toBe(200);
    expect(await hiddenOf(id)).toBe(1);
    const unhide = await hide(id, false);
    expect(unhide.status).toBe(404);
    expect(await unhide.json()).toEqual({ error: 'Không tìm thấy giao dịch' });
    expect(await hiddenOf(id)).toBe(1);
  });

  it('works (200) for the same user with finance.view_all (expense row, hide and unhide)', async () => {
    const id = await seed('expense');
    expect((await hide(id, true)).status).toBe(200);
    expect(await hiddenOf(id)).toBe(1);
    expect((await hide(id, false)).status).toBe(200);
    expect(await hiddenOf(id)).toBe(0);
  });
});

describe('finance.view_all does not imply hidden-row visibility (records.hide required) (F-3)', () => {
  async function seed(type, hidden = 1) {
    const r = await env.DB.prepare(
      `INSERT INTO finance_transactions (type, category, amount, transaction_date, status, created_by, created_at, is_hidden) VALUES (?, ?, 100000, '2026-09-01', 'draft', 'quan_ly_fin', '2026-09-01T00:00:00Z', ?)`
    ).bind(type, type === 'income' ? 'ban_hang' : 'vat_tu', hidden).run();
    return String(r.meta.last_row_id);
  }

  it('PATCH answers a hidden income and a hidden expense exactly like a non-existent id for a manager with finance.view_all but no records.hide, rows unchanged', async () => {
    const hiddenIncome = await seed('income');
    const hiddenExpense = await seed('expense');
    const missing = await patchTransaction({ request: authedRequest('https://x/api/finance/transactions/999999', managerToken, 'PATCH', { amount: 999000 }), env, params: { id: '999999' } });
    const missingBody = await missing.json();
    expect(missing.status).toBe(404);
    for (const id of [hiddenIncome, hiddenExpense]) {
      const res = await patchTransaction({ request: authedRequest(`https://x/api/finance/transactions/${id}`, managerToken, 'PATCH', { amount: 999000 }), env, params: { id } });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(missingBody);
      expect((await env.DB.prepare('SELECT amount FROM finance_transactions WHERE id = ?').bind(id).first()).amount).toBe(100000);
    }
  });

  it('void answers a hidden income exactly like a non-existent id for a manager with finance.view_all but no records.hide, row unchanged', async () => {
    const hiddenIncome = await seed('income');
    const response = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${hiddenIncome}/void`, managerToken, 'PATCH'), env, params: { id: hiddenIncome } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Không tìm thấy giao dịch' });
    expect((await env.DB.prepare('SELECT voided_at FROM finance_transactions WHERE id = ?').bind(hiddenIncome).first()).voided_at).toBeNull();
  });

  it('admin (all permissions) can PATCH and void a hidden row', async () => {
    const hiddenIncome = await seed('income');
    const patchRes = await patchTransaction({ request: authedRequest(`https://x/api/finance/transactions/${hiddenIncome}`, adminToken, 'PATCH', { amount: 999000 }), env, params: { id: hiddenIncome } });
    expect(patchRes.status).toBe(200);
    const hiddenExpense = await seed('expense');
    const voidRes = await voidTransaction({ request: authedRequest(`https://x/api/finance/transactions/${hiddenExpense}/void`, adminToken, 'PATCH'), env, params: { id: hiddenExpense } });
    expect(voidRes.status).toBe(200);
  });

  it('does not affect a non-hidden row for the same manager (regression)', async () => {
    const visible = await seed('income', 0);
    const response = await patchTransaction({ request: authedRequest(`https://x/api/finance/transactions/${visible}`, managerToken, 'PATCH', { amount: 999000 }), env, params: { id: visible } });
    expect(response.status).toBe(200);
  });
});
