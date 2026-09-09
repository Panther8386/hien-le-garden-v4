import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getHolidays, onRequestPost as postHoliday } from '../functions/api/holidays/index.js';
import { onRequestPatch as patchHoliday, onRequestDelete as deleteHoliday } from '../functions/api/holidays/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM holidays');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_hd', 'x', 'manager', '2026-08-01T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_hd', 'x', 'reception', '2026-08-01T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_hd', 'x', 'admin', '2026-08-01T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_hd', 'x', 'observer', '2026-08-01T00:00:00Z')`).run();
  managerToken = await createSession(env.DB, m.meta.last_row_id);
  receptionToken = await createSession(env.DB, r.meta.last_row_id);
  adminToken = await createSession(env.DB, a.meta.last_row_id);
  observerToken = await createSession(env.DB, o.meta.last_row_id);

  await env.DB.prepare(
    `INSERT INTO holidays (name, start_date, end_date, updated_by, updated_at) VALUES ('Tết Nguyên Đán', '2027-02-06', '2027-02-10', 'seed', '2026-08-01T00:00:00Z')`
  ).run();
  await env.DB.prepare(
    `INSERT INTO holidays (name, start_date, end_date, updated_by, updated_at) VALUES ('Quốc khánh', '2026-09-02', '2026-09-02', 'seed', '2026-08-01T00:00:00Z')`
  ).run();
});

function authedRequest(url, token, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Cookie = `session=${token}`;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('GET /api/holidays', () => {
  it('lets reception view holidays, ordered by start date', async () => {
    const response = await getHolidays({ request: authedRequest('https://x/api/holidays', receptionToken, 'GET'), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.map((h) => h.name)).toEqual(['Quốc khánh', 'Tết Nguyên Đán']);
  });

  it('lets observer view holidays', async () => {
    const response = await getHolidays({ request: authedRequest('https://x/api/holidays', observerToken, 'GET'), env });
    expect(response.status).toBe(200);
  });

  it('rejects no session (401)', async () => {
    const response = await getHolidays({ request: new Request('https://x/api/holidays'), env });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/holidays', () => {
  it('lets an admin add a holiday', async () => {
    const response = await postHoliday({
      request: authedRequest('https://x/api/holidays', adminToken, 'POST', { name: 'Giỗ Tổ Hùng Vương', startDate: '2027-04-16', endDate: '2027-04-16' }),
      env,
    });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(`SELECT * FROM holidays WHERE name = 'Giỗ Tổ Hùng Vương'`).first();
    expect(row.start_date).toBe('2027-04-16');
  });

  it('rejects an empty name (400)', async () => {
    const response = await postHoliday({
      request: authedRequest('https://x/api/holidays', adminToken, 'POST', { name: '', startDate: '2027-04-16', endDate: '2027-04-16' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects endDate before startDate (400)', async () => {
    const response = await postHoliday({
      request: authedRequest('https://x/api/holidays', adminToken, 'POST', { name: 'X', startDate: '2027-04-16', endDate: '2027-04-15' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-admin (403)', async () => {
    const response = await postHoliday({
      request: authedRequest('https://x/api/holidays', managerToken, 'POST', { name: 'X', startDate: '2027-04-16', endDate: '2027-04-16' }),
      env,
    });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/holidays/:id', () => {
  it('lets an admin edit a holiday', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM holidays WHERE name = 'Quốc khánh'`).first();
    const response = await patchHoliday({
      request: authedRequest(`https://x/api/holidays/${existing.id}`, adminToken, 'PATCH', { endDate: '2026-09-03' }),
      env,
      params: { id: String(existing.id) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT end_date FROM holidays WHERE id = ?`).bind(existing.id).first();
    expect(row.end_date).toBe('2026-09-03');
  });

  it('404s for a missing id', async () => {
    const response = await patchHoliday({
      request: authedRequest('https://x/api/holidays/999999', adminToken, 'PATCH', { endDate: '2026-09-03' }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('rejects a non-admin (403)', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM holidays WHERE name = 'Quốc khánh'`).first();
    const response = await patchHoliday({
      request: authedRequest(`https://x/api/holidays/${existing.id}`, receptionToken, 'PATCH', { name: 'Should not apply' }),
      env,
      params: { id: String(existing.id) },
    });
    expect(response.status).toBe(403);
  });
});

describe('DELETE /api/holidays/:id', () => {
  it('lets an admin delete a holiday (real hard delete)', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM holidays WHERE name = 'Quốc khánh'`).first();
    const response = await deleteHoliday({ request: authedRequest(`https://x/api/holidays/${existing.id}`, adminToken, 'DELETE'), env, params: { id: String(existing.id) } });
    expect(response.status).toBe(204);

    const row = await env.DB.prepare(`SELECT id FROM holidays WHERE id = ?`).bind(existing.id).first();
    expect(row).toBeNull();

    const again = await deleteHoliday({ request: authedRequest(`https://x/api/holidays/${existing.id}`, adminToken, 'DELETE'), env, params: { id: String(existing.id) } });
    expect(again.status).toBe(404);
  });

  it('writes no audit_log row on delete', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM holidays WHERE name = 'Quốc khánh'`).first();
    const before = await env.DB.prepare(`SELECT COUNT(*) AS c FROM audit_log`).first();
    await deleteHoliday({ request: authedRequest(`https://x/api/holidays/${existing.id}`, adminToken, 'DELETE'), env, params: { id: String(existing.id) } });
    const after = await env.DB.prepare(`SELECT COUNT(*) AS c FROM audit_log`).first();
    expect(after.c).toBe(before.c);
  });

  it('rejects reception (403)', async () => {
    const existing = await env.DB.prepare(`SELECT id FROM holidays WHERE name = 'Quốc khánh'`).first();
    const response = await deleteHoliday({ request: authedRequest(`https://x/api/holidays/${existing.id}`, receptionToken, 'DELETE'), env, params: { id: String(existing.id) } });
    expect(response.status).toBe(403);
  });
});
