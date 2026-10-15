// Guarantees the rollback build must keep once migration 0046 has run and service orders have
// produced finance rows: those rows stay locked in Thu chi, and editing role permissions does not
// silently drop the service-order keys seeded by 0046. Runs unchanged on the service-orders branch
// and on the 0046-compatible rollback build.
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listTransactions } from '../functions/api/finance/transactions/index.js';
import { onRequestPatch as patchTransaction } from '../functions/api/finance/transactions/[id].js';
import { onRequestPatch as voidTransaction } from '../functions/api/finance/transactions/[id]/void.js';
import { onRequestPut as putRolePermissions } from '../functions/api/roles/[role]/permissions.js';
import { createSession } from '../lib/auth.js';
import { isValidPermission } from '../lib/permissions.js';

let adminToken;
let txId;

beforeEach(async () => {
  for (const t of ['audit_log', 'service_order_deposits', 'service_order_items', 'booking_deposits', 'finance_transactions',
    'service_orders', 'sessions', 'staff_accounts']) {
    await env.DB.exec(`DELETE FROM ${t}`);
  }
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_rb', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  const order = await env.DB.prepare(`INSERT INTO service_orders
    (creation_key, order_type, customer_name, phone, event_date, primary_category, deposit_amount, quote_valid_days, status, created_by, created_at)
    VALUES ('rb-1', 'dat_tiec', 'Khách', '0900000000', '2026-12-01', 'bep_hien_le', 500000, 7, 'confirmed', 'x', '2026-10-15T00:00:00Z')`).run();
  const tx = await env.DB.prepare(`INSERT INTO finance_transactions (type, category, amount, note, transaction_date, status, created_by, created_at, service_order_id)
    VALUES ('income', 'bep_hien_le', 500000, 'Cọc đơn', '2026-10-15', 'confirmed', 'x', '2026-10-15T00:00:00Z', ?)`).bind(order.meta.last_row_id).run();
  txId = String(tx.meta.last_row_id);
});

function request(url, method, body) {
  return new Request(url, { method, headers: { 'Content-Type': 'application/json', Cookie: `session=${adminToken}` }, body: body ? JSON.stringify(body) : undefined });
}
const UNCHANGED = { type: 'income', category: 'bep_hien_le', amount: 500000, transactionDate: '2026-10-15', status: 'confirmed' };

describe('service-order finance rows stay locked (rollback guarantee)', () => {
  it('cannot be voided on their own', async () => {
    const response = await voidTransaction({ request: request(`https://x/api/finance/transactions/${txId}/void`, 'PATCH', {}), env, params: { id: txId } });
    expect(response.status).toBe(409);
    expect((await env.DB.prepare('SELECT voided_at FROM finance_transactions WHERE id = ?').bind(txId).first()).voided_at).toBeNull();
  });

  it('cannot have amount, category or status changed, but the note stays editable', async () => {
    for (const change of [{ amount: 1 }, { category: 'ban_hang' }, { status: 'paid' }]) {
      const response = await patchTransaction({ request: request(`https://x/api/finance/transactions/${txId}`, 'PATCH', { ...UNCHANGED, note: 'Cọc đơn', ...change }), env, params: { id: txId } });
      expect(response.status).toBe(400);
    }
    expect(await env.DB.prepare('SELECT amount, category, status FROM finance_transactions WHERE id = ?').bind(txId).first())
      .toEqual({ amount: 500000, category: 'bep_hien_le', status: 'confirmed' });
    const note = await patchTransaction({ request: request(`https://x/api/finance/transactions/${txId}`, 'PATCH', { ...UNCHANGED, note: 'Ghi chú mới' }), env, params: { id: txId } });
    expect(note.status).toBe(200);
  });

  it('are flagged linked in the finance list so the form locks them', async () => {
    const { transactions } = await (await listTransactions({ request: request('https://x/api/finance/transactions', 'GET'), env })).json();
    expect(transactions.find((t) => String(t.id) === txId).linked).toBe(true);
  });
});

describe('role permission edits keep the keys seeded by migration 0046 (rollback guarantee)', () => {
  it('saving reception permissions as the admin page shows them keeps service_orders.view and manage', async () => {
    const { results } = await env.DB.prepare(`SELECT permission FROM role_permissions WHERE role = 'reception'`).all();
    // The admin page only renders (and resubmits) keys the running code knows.
    const shown = results.map((r) => r.permission).filter(isValidPermission);
    const response = await putRolePermissions({ request: request('https://x/api/roles/reception/permissions', 'PUT', { permissions: shown }), env, params: { role: 'reception' } });
    expect(response.status).toBe(200);
    const after = (await env.DB.prepare(`SELECT permission FROM role_permissions WHERE role = 'reception'`).all()).results.map((r) => r.permission);
    expect(after).toEqual(expect.arrayContaining(['service_orders.view', 'service_orders.manage']));
  });
});
