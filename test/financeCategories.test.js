import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listCategories, onRequestPost as createCategory } from '../functions/api/finance/categories/index.js';
import { onRequestPatch as patchCategory } from '../functions/api/finance/categories/[id].js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');

  const m = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_ly_cat', 'x', 'manager', '2026-09-03T00:00:00Z')`).run();
  const r = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('le_tan_cat', 'x', 'reception', '2026-09-03T00:00:00Z')`).run();
  const a = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('admin_cat', 'x', 'admin', '2026-09-03T00:00:00Z')`).run();
  const o = await env.DB.prepare(`INSERT INTO staff_accounts (username, password_hash, role, created_at) VALUES ('quan_sat_cat', 'x', 'observer', '2026-09-03T00:00:00Z')`).run();
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

describe('GET /api/finance/categories', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await listCategories({ request: new Request('https://x/api/finance/categories'), env });
    expect(response.status).toBe(401);
  });

  it('rejects reception (403)', async () => {
    const response = await listCategories({ request: authedRequest('https://x/api/finance/categories', receptionToken, 'GET'), env });
    expect(response.status).toBe(403);
  });

  it('lets manager, admin, and observer list, including inactive rows', async () => {
    await env.DB.prepare(`UPDATE finance_categories SET is_active = 0 WHERE slug = 'khac'`).run();
    for (const token of [managerToken, adminToken, observerToken]) {
      const response = await listCategories({ request: authedRequest('https://x/api/finance/categories', token, 'GET'), env });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveLength(14);
      const khac = body.find((c) => c.slug === 'khac');
      expect(khac.isActive).toBe(false);
    }
  });

  it('returns the exact field shape expected by clients', async () => {
    const response = await listCategories({ request: authedRequest('https://x/api/finance/categories', managerToken, 'GET'), env });
    const body = await response.json();
    const dichVu = body.find((c) => c.slug === 'dich_vu');
    expect(dichVu).toMatchObject({ slug: 'dich_vu', label: 'Lưu trú Hiền Lê', type: 'income', isActive: true });
    expect(typeof dichVu.id).toBe('number');
  });
});

describe('POST /api/finance/categories', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', null, 'POST', { label: 'Test', type: 'income' }), env });
    expect(response.status).toBe(401);
  });

  it('rejects manager (403) — creating a category is admin-only', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', managerToken, 'POST', { label: 'Test', type: 'income' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects reception (403)', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', receptionToken, 'POST', { label: 'Test', type: 'income' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects observer (403)', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', observerToken, 'POST', { label: 'Test', type: 'income' }), env });
    expect(response.status).toBe(403);
  });

  it('rejects an empty label (400)', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', adminToken, 'POST', { label: '   ', type: 'income' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid type (400)', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', adminToken, 'POST', { label: 'Test', type: 'neither' }), env });
    expect(response.status).toBe(400);
  });

  it('generates a Vietnamese-diacritics-stripped slug and creates the category active by default', async () => {
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', adminToken, 'POST', { label: 'Sự kiện đặc biệt', type: 'income' }), env });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.slug).toBe('su_kien_dac_biet');
    expect(body.label).toBe('Sự kiện đặc biệt');
    expect(body.type).toBe('income');
    expect(body.isActive).toBe(true);

    const row = await env.DB.prepare(`SELECT * FROM finance_categories WHERE slug = 'su_kien_dac_biet'`).first();
    expect(row.created_by).toBe('admin_cat');
    const auditRow = await env.DB.prepare(`SELECT * FROM audit_log WHERE entity_type = 'finance_category' AND action_type = 'finance_category_create'`).first();
    expect(auditRow).not.toBeNull();
  });

  it('rejects a label that generates a slug already in use, active or not (400)', async () => {
    await env.DB.prepare(`UPDATE finance_categories SET is_active = 0 WHERE slug = 'khac'`).run();
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', adminToken, 'POST', { label: 'Khác', type: 'expense' }), env });
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/finance/categories/:id', () => {
  let categoryId;
  beforeEach(async () => {
    const row = await env.DB.prepare(`SELECT id FROM finance_categories WHERE slug = 'khac'`).first();
    categoryId = row.id;
  });

  it('rejects manager (403)', async () => {
    const response = await patchCategory({ request: authedRequest(`https://x/api/finance/categories/${categoryId}`, managerToken, 'PATCH', { label: 'Đổi tên' }), env, params: { id: String(categoryId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await patchCategory({ request: authedRequest('https://x/api/finance/categories/999999', adminToken, 'PATCH', { label: 'Đổi tên' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('edits the label only', async () => {
    const response = await patchCategory({ request: authedRequest(`https://x/api/finance/categories/${categoryId}`, adminToken, 'PATCH', { label: 'Chi phí khác (đã sửa)' }), env, params: { id: String(categoryId) } });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT label, slug, type FROM finance_categories WHERE id = ?`).bind(categoryId).first();
    expect(row.label).toBe('Chi phí khác (đã sửa)');
    expect(row.slug).toBe('khac');   // slug never changes
    expect(row.type).toBe('expense'); // type never changes
  });

  it('toggles isActive off then back on', async () => {
    const off = await patchCategory({ request: authedRequest(`https://x/api/finance/categories/${categoryId}`, adminToken, 'PATCH', { isActive: false }), env, params: { id: String(categoryId) } });
    expect(off.status).toBe(200);
    let row = await env.DB.prepare(`SELECT is_active FROM finance_categories WHERE id = ?`).bind(categoryId).first();
    expect(row.is_active).toBe(0);

    const on = await patchCategory({ request: authedRequest(`https://x/api/finance/categories/${categoryId}`, adminToken, 'PATCH', { isActive: true }), env, params: { id: String(categoryId) } });
    expect(on.status).toBe(200);
    row = await env.DB.prepare(`SELECT is_active FROM finance_categories WHERE id = ?`).bind(categoryId).first();
    expect(row.is_active).toBe(1);
  });

  it('silently ignores type and slug in the body rather than erroring', async () => {
    const response = await patchCategory({
      request: authedRequest(`https://x/api/finance/categories/${categoryId}`, adminToken, 'PATCH', { label: 'Vẫn hợp lệ', type: 'income', slug: 'hacked_slug' }),
      env,
      params: { id: String(categoryId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT label, slug, type FROM finance_categories WHERE id = ?`).bind(categoryId).first();
    expect(row.label).toBe('Vẫn hợp lệ');
    expect(row.slug).toBe('khac');
    expect(row.type).toBe('expense');
  });

  it('rejects an empty label (400)', async () => {
    const response = await patchCategory({ request: authedRequest(`https://x/api/finance/categories/${categoryId}`, adminToken, 'PATCH', { label: '  ' }), env, params: { id: String(categoryId) } });
    expect(response.status).toBe(400);
  });

  it('does not crash on a literal null body (falls through to existing values)', async () => {
    const response = await patchCategory({
      request: new Request(`https://x/api/finance/categories/${categoryId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: `session=${adminToken}` }, body: 'null' }),
      env,
      params: { id: String(categoryId) },
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare(`SELECT label, is_active FROM finance_categories WHERE id = ?`).bind(categoryId).first();
    expect(row.label).toBe('Khác');
    expect(row.is_active).toBe(1);
  });
});
