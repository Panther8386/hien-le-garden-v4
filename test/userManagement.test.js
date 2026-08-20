import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestDelete as deleteUser } from '../functions/api/users/[id].js';
import { onRequestPatch as changeRole } from '../functions/api/users/[id]/role.js';
import { createSession } from '../lib/auth.js';

let managerAId, managerBId, receptionId, managerAToken, receptionToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');

  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_a', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const b = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_b', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const c = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_a', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  managerAId = a.meta.last_row_id;
  managerBId = b.meta.last_row_id;
  receptionId = c.meta.last_row_id;
  managerAToken = await createSession(env.DB, managerAId);
  receptionToken = await createSession(env.DB, receptionId);
});

function authedRequest(url, token, method, body) {
  return new Request(url, { method, headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

describe('DELETE /api/users/:id', () => {
  it('lets a manager delete a reception account', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${receptionId}`, managerAToken, 'DELETE'), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(204);
  });

  it('rejects deleting your own account (400)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerAId}`, managerAToken, 'DELETE'), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(400);
  });

  it('deleting a manager always leaves at least one manager, since only a manager can delete another', async () => {
    // A deletes B: A can never delete itself, so the acting manager always remains — the
    // count can never reach zero this way. This is why DELETE needs no separate "last
    // manager" count guard; see the implementation note below Step 3 for the full argument.
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, managerAToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(204);

    const managerCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_accounts WHERE role = 'manager'`).first();
    expect(managerCount.n).toBe(1);
  });

  it('rejects a reception account (403)', async () => {
    const response = await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, receptionToken, 'DELETE'), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('lets a manager change another account role', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'manager' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT role FROM staff_accounts WHERE id = ?`).bind(receptionId).first();
    expect(row.role).toBe('manager');
  });

  it('rejects an invalid role value', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${receptionId}/role`, managerAToken, 'PATCH', { role: 'admin' }), env, params: { id: String(receptionId) } });
    expect(response.status).toBe(400);
  });

  it('rejects demoting the last manager (400)', async () => {
    await deleteUser({ request: authedRequest(`https://x/api/users/${managerBId}`, managerAToken, 'DELETE'), env, params: { id: String(managerBId) } });
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerAId}/role`, managerAToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerAId) } });
    expect(response.status).toBe(400);
  });

  it('rejects a reception account (403)', async () => {
    const response = await changeRole({ request: authedRequest(`https://x/api/users/${managerBId}/role`, receptionToken, 'PATCH', { role: 'reception' }), env, params: { id: String(managerBId) } });
    expect(response.status).toBe(403);
  });
});
