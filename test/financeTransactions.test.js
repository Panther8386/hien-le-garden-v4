import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTransactions, onRequestPost as createTransaction } from '../functions/api/finance/transactions/index.js';
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

  it('lets observer list (read-only role)', async () => {
    const response = await listTransactions({ request: authedRequest('https://x/api/finance/transactions', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(3);
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
});
