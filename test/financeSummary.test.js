import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getSummary } from '../functions/api/finance/summary.js';
import { onRequestGet as getOpeningBalance, onRequestPatch as setOpeningBalance } from '../functions/api/finance/opening-balance.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, observerToken, adminToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM finance_transactions');
  await env.DB.exec('DELETE FROM finance_opening_balance');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_sum', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_sum', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_sum', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_sum', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, a.meta.last_row_id);
});

function authedRequest(url, token, method, body) {
  const headers = {};
  if (token) headers.Cookie = `session=${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function insertTx({ type, category, amount, date, status = 'confirmed', voided = false }) {
  await env.DB.prepare(
    `INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, voided_by, voided_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'quan_ly_sum', '2026-08-01T00:00:00Z', ?, ?)`
  ).bind(type, category, amount, date, status, voided ? 'quan_ly_sum' : null, voided ? '2026-08-01T00:00:00Z' : null).run();
}

describe('GET /api/finance/summary', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await getSummary({ request: new Request('https://x/api/finance/summary?month=2026-08'), env });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', receptionToken, 'GET'), env });
    expect(response.status).toBe(403);
  });

  it('lets observer read, but strips every expense-derived field from the response', async () => {
    await insertTx({ type: 'income', category: 'ban_hang', amount: 1000000, date: '2026-08-10' });
    await insertTx({ type: 'expense', category: 'vat_tu', amount: 300000, date: '2026-08-15' });

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ month: '2026-08', totalIncome: 1000000 });
    expect(body).not.toHaveProperty('totalExpense');
    expect(body).not.toHaveProperty('netChange');
    expect(body).not.toHaveProperty('closingBalance');
    expect(body).not.toHaveProperty('openingBalance');
    expect(body).not.toHaveProperty('openingBalanceSource');
  });

  it('manager and admin still get the full response shape (no regression)', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body).toHaveProperty('openingBalance');
    expect(body).toHaveProperty('totalExpense');
    expect(body).toHaveProperty('closingBalance');
  });

  it('rejects a malformed month (400)', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-8', managerToken, 'GET'), env });
    expect(response.status).toBe(400);
  });

  it('rejects a missing month (400)', async () => {
    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary', managerToken, 'GET'), env });
    expect(response.status).toBe(400);
  });

  it('defaults to a zero opening balance when no manual value was ever set and there are no earlier transactions', async () => {
    await insertTx({ type: 'income', category: 'ban_hang', amount: 1000000, date: '2026-08-10' });
    await insertTx({ type: 'expense', category: 'vat_tu', amount: 300000, date: '2026-08-15' });

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.openingBalanceSource).toBe('default_zero');
    expect(body.openingBalance).toBe(0);
    expect(body.totalIncome).toBe(1000000);
    expect(body.totalExpense).toBe(300000);
    expect(body.netChange).toBe(700000);
    expect(body.closingBalance).toBe(700000);
  });

  it('excludes draft transactions and voided transactions from totals', async () => {
    await insertTx({ type: 'income', category: 'ban_hang', amount: 1000000, date: '2026-08-10', status: 'confirmed' });
    await insertTx({ type: 'income', category: 'ban_hang', amount: 500000, date: '2026-08-11', status: 'draft' });
    await insertTx({ type: 'expense', category: 'vat_tu', amount: 200000, date: '2026-08-12', status: 'confirmed', voided: true });

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.totalIncome).toBe(1000000);
    expect(body.totalExpense).toBe(0);
  });

  it('uses a manually-set opening balance for the exact requested month', async () => {
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-08', 5000000, 'quan_ly_sum', '2026-08-01T00:00:00Z')`).run();
    await insertTx({ type: 'income', category: 'ban_hang', amount: 1000000, date: '2026-08-10' });

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.openingBalanceSource).toBe('manual');
    expect(body.openingBalance).toBe(5000000);
    expect(body.closingBalance).toBe(6000000);
  });

  it('carries forward from the most recent earlier manual value, summing all confirmed/paid transactions in between', async () => {
    // manual value set for June; no manual value for July or August
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-06', 2000000, 'quan_ly_sum', '2026-06-01T00:00:00Z')`).run();
    await insertTx({ type: 'income', category: 'ban_hang', amount: 1000000, date: '2026-06-15' }); // June: +1,000,000
    await insertTx({ type: 'expense', category: 'vat_tu', amount: 400000, date: '2026-07-05' });   // July: -400,000
    await insertTx({ type: 'income', category: 'dich_vu', amount: 300000, date: '2026-07-20' });   // July: +300,000
    await insertTx({ type: 'income', category: 'ban_hang', amount: 900000, date: '2026-08-05' });  // August (this month itself, not part of carry-forward)

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    // openingBalance(Aug) = 2,000,000 (June anchor) + 1,000,000 (June txns) - 400,000 + 300,000 (July txns) = 2,900,000
    expect(body.openingBalanceSource).toBe('carried_forward');
    expect(body.openingBalance).toBe(2900000);
    expect(body.totalIncome).toBe(900000);
    expect(body.totalExpense).toBe(0);
    expect(body.closingBalance).toBe(3800000);
  });

  it('when a manual value exists for the exact month, ignores any earlier manual value (no double-carrying)', async () => {
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-06', 100, 'quan_ly_sum', '2026-06-01T00:00:00Z')`).run();
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-08', 999000, 'quan_ly_sum', '2026-08-01T00:00:00Z')`).run();
    await insertTx({ type: 'expense', category: 'vat_tu', amount: 50000, date: '2026-07-10' }); // should NOT be subtracted; Aug has its own manual value

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.openingBalanceSource).toBe('manual');
    expect(body.openingBalance).toBe(999000);
  });

  it('insert-only: the latest inserted row for a period wins even if an older row for the same period exists', async () => {
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-08', 1000, 'quan_ly_sum', '2026-08-01T00:00:00Z')`).run();
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-08', 2000, 'quan_ly_sum', '2026-08-02T00:00:00Z')`).run();

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.openingBalance).toBe(2000);
  });

  it('supports a negative opening balance', async () => {
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-08', -300000, 'quan_ly_sum', '2026-08-01T00:00:00Z')`).run();
    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.openingBalance).toBe(-300000);
    expect(body.closingBalance).toBe(-300000);
  });

  it('handles the December→January year rollover correctly (nextMonth edge case)', async () => {
    await env.DB.prepare(`INSERT INTO finance_opening_balance (period, opening_balance, set_by, set_at) VALUES ('2026-12', 1000000, 'quan_ly_sum', '2026-12-01T00:00:00Z')`).run();
    await insertTx({ type: 'income', category: 'ban_hang', amount: 500000, date: '2026-12-20' });
    await insertTx({ type: 'expense', category: 'vat_tu', amount: 100000, date: '2027-01-05' }); // must NOT count toward December's own totals — this is exactly what exercises the year-rollover boundary

    const response = await getSummary({ request: authedRequest('https://x/api/finance/summary?month=2026-12', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.openingBalanceSource).toBe('manual');
    expect(body.openingBalance).toBe(1000000);
    expect(body.totalIncome).toBe(500000);
    expect(body.totalExpense).toBe(0);
    expect(body.closingBalance).toBe(1500000);
  });
});

describe('GET/PATCH /api/finance/opening-balance', () => {
  it('GET rejects reception (403)', async () => {
    const response = await getOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance?period=2026-08', receptionToken, 'GET'), env });
    expect(response.status).toBe(403);
  });

  it('GET rejects observer (403) — opening balance is expense-derived data, off-limits to this role', async () => {
    const response = await getOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance?period=2026-08', observerToken, 'GET'), env });
    expect(response.status).toBe(403);
  });

  it('GET returns nulls when nothing was ever set for the exact period', async () => {
    const response = await getOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance?period=2026-08', managerToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ period: '2026-08', openingBalance: null, setBy: null, setAt: null });
  });

  it('GET rejects a malformed period (400)', async () => {
    const response = await getOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance?period=2026-8', managerToken, 'GET'), env });
    expect(response.status).toBe(400);
  });

  it('PATCH rejects reception (403)', async () => {
    const response = await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', receptionToken, 'PATCH', { period: '2026-08', openingBalance: 1000 }), env });
    expect(response.status).toBe(403);
  });

  it('PATCH rejects observer (403)', async () => {
    const response = await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', observerToken, 'PATCH', { period: '2026-08', openingBalance: 1000 }), env });
    expect(response.status).toBe(403);
  });

  it('PATCH rejects a malformed period (400)', async () => {
    const response = await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', managerToken, 'PATCH', { period: 'August', openingBalance: 1000 }), env });
    expect(response.status).toBe(400);
  });

  it('PATCH rejects a non-integer openingBalance (400)', async () => {
    const response = await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', managerToken, 'PATCH', { period: '2026-08', openingBalance: 12.5 }), env });
    expect(response.status).toBe(400);
  });

  it('PATCH accepts a negative openingBalance', async () => {
    const response = await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', managerToken, 'PATCH', { period: '2026-08', openingBalance: -500 }), env });
    expect(response.status).toBe(200);
  });

  it('PATCH inserts a new row (never UPDATEs); GET reads the latest by id for that exact period', async () => {
    await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', managerToken, 'PATCH', { period: '2026-08', openingBalance: 1000 }), env });
    await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', adminToken, 'PATCH', { period: '2026-08', openingBalance: 2000 }), env });

    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM finance_opening_balance WHERE period = '2026-08'`).first();
    expect(countRow.c).toBe(2);

    const response = await getOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance?period=2026-08', managerToken, 'GET'), env });
    const body = await response.json();
    expect(body.openingBalance).toBe(2000);
    expect(body.setBy).toBe('admin_sum');
  });

  it('PATCH writes an audit_log row', async () => {
    await setOpeningBalance({ request: authedRequest('https://x/api/finance/opening-balance', managerToken, 'PATCH', { period: '2026-09', openingBalance: 777000 }), env });
    const auditRow = await env.DB.prepare(
      `SELECT * FROM audit_log WHERE entity_type = 'finance_opening_balance' AND action_type = 'finance_opening_balance_set'`
    ).first();
    expect(auditRow).not.toBeNull();
    expect(auditRow.entity_label).toBe('2026-09');
    expect(auditRow.new_value).toBe('777000');
    expect(auditRow.old_value).toBeNull();
  });
});
