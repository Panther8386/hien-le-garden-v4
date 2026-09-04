import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as listCategories, onRequestPost as createCategory } from '../functions/api/finance/categories/index.js';
import { onRequestPatch as patchCategory } from '../functions/api/finance/categories/[id].js';
import { onRequestPatch as moveCategory } from '../functions/api/finance/categories/[id]/move.js';
import { createSession } from '../lib/auth.js';

let managerToken, receptionToken, adminToken, observerToken;

const SEED_CATEGORY_SLUGS = [
  'cay_giong', 'vat_tu', 'nhan_cong', 'van_chuyen', 'bao_tri', 'thuc_pham', 'am_thuc_lien_ket', 'khac',
  'ban_hang', 'dich_vu', 'bep_hien_le', 'hien_le_drinks', 'hh_am_thuc_lien_ket', 'gio_xanh_hien_le',
];

beforeEach(async () => {
  await env.DB.exec('DELETE FROM staff_accounts');
  await env.DB.exec('DELETE FROM sessions');
  // Defensive reset: this table is pre-seeded (migration 0018) rather than empty-by-default,
  // so it normally relies entirely on the test runner's automatic per-test storage rollback to
  // stay at exactly the 14 seed rows. On this environment that rollback intermittently misses a
  // beat (a well-documented Windows Miniflare isolated-storage flake, unrelated to this file's
  // own logic), which otherwise surfaces here as a stray extra row leaking from an insert test
  // into a later count-based assertion. Explicitly pruning back to the known seed slugs makes
  // every test in this file start from a guaranteed-clean baseline regardless of that flake.
  await env.DB.prepare(
    `DELETE FROM finance_categories WHERE slug NOT IN (${SEED_CATEGORY_SLUGS.map(() => '?').join(',')})`
  ).bind(...SEED_CATEGORY_SLUGS).run();

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
    expect(typeof dichVu.displayOrder).toBe('number');
  });

  it('orders each type by display_order, reflecting a prior reorder', async () => {
    const before = await listCategories({ request: authedRequest('https://x/api/finance/categories', managerToken, 'GET'), env });
    const beforeBody = await before.json();
    const expenseIds = beforeBody.filter((c) => c.type === 'expense').map((c) => c.id);
    expect(expenseIds.length).toBeGreaterThan(1);

    await moveCategory({ request: authedRequest(`https://x/api/finance/categories/${expenseIds[1]}/move`, adminToken, 'PATCH', { direction: 'up' }), env, params: { id: String(expenseIds[1]) } });

    const after = await listCategories({ request: authedRequest('https://x/api/finance/categories', managerToken, 'GET'), env });
    const afterBody = await after.json();
    const afterExpenseIds = afterBody.filter((c) => c.type === 'expense').map((c) => c.id);
    expect(afterExpenseIds[0]).toBe(expenseIds[1]);
    expect(afterExpenseIds[1]).toBe(expenseIds[0]);
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

  it('appends the new category at the end of its type (max display_order + 1)', async () => {
    const maxBefore = await env.DB.prepare(`SELECT MAX(display_order) AS m FROM finance_categories WHERE type = 'income'`).first();
    const response = await createCategory({ request: authedRequest('https://x/api/finance/categories', adminToken, 'POST', { label: 'Nguồn thu mới', type: 'income' }), env });
    const body = await response.json();
    const row = await env.DB.prepare(`SELECT display_order FROM finance_categories WHERE id = ?`).bind(body.id).first();
    expect(row.display_order).toBe(maxBefore.m + 1);
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
    expect(row.label).toBe('Chi phí khác');
    expect(row.is_active).toBe(1);
  });
});

describe('PATCH /api/finance/categories/:id/move', () => {
  let firstId, secondId, thirdId;
  beforeEach(async () => {
    const { results } = await env.DB.prepare(`SELECT id FROM finance_categories WHERE type = 'expense' ORDER BY display_order, id LIMIT 3`).all();
    [firstId, secondId, thirdId] = results.map((r) => r.id);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await moveCategory({ request: new Request(`https://x/api/finance/categories/${secondId}/move`, { method: 'PATCH' }), env, params: { id: String(secondId) } });
    expect(response.status).toBe(401);
  });

  it('rejects manager (403) — reordering is admin-only', async () => {
    const response = await moveCategory({ request: authedRequest(`https://x/api/finance/categories/${secondId}/move`, managerToken, 'PATCH', { direction: 'up' }), env, params: { id: String(secondId) } });
    expect(response.status).toBe(403);
  });

  it('404s for a non-existent id', async () => {
    const response = await moveCategory({ request: authedRequest('https://x/api/finance/categories/999999/move', adminToken, 'PATCH', { direction: 'up' }), env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('rejects an invalid direction (400)', async () => {
    const response = await moveCategory({ request: authedRequest(`https://x/api/finance/categories/${secondId}/move`, adminToken, 'PATCH', { direction: 'sideways' }), env, params: { id: String(secondId) } });
    expect(response.status).toBe(400);
  });

  it('swaps display_order with the previous sibling of the same type when moving up', async () => {
    const response = await moveCategory({ request: authedRequest(`https://x/api/finance/categories/${secondId}/move`, adminToken, 'PATCH', { direction: 'up' }), env, params: { id: String(secondId) } });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT id FROM finance_categories WHERE type = 'expense' ORDER BY display_order, id LIMIT 3`).all();
    expect(results.map((r) => r.id)).toEqual([secondId, firstId, thirdId]);
  });

  it('does nothing (200, no change) when the first item in its type tries to move up', async () => {
    const response = await moveCategory({ request: authedRequest(`https://x/api/finance/categories/${firstId}/move`, adminToken, 'PATCH', { direction: 'up' }), env, params: { id: String(firstId) } });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT id FROM finance_categories WHERE type = 'expense' ORDER BY display_order, id LIMIT 3`).all();
    expect(results.map((r) => r.id)).toEqual([firstId, secondId, thirdId]);
  });

  it('does nothing (200, no change) when the last item in its type tries to move down, never reaching into a different type', async () => {
    const { results: lastExpense } = await env.DB.prepare(`SELECT id, display_order FROM finance_categories WHERE type = 'expense' ORDER BY display_order DESC, id DESC LIMIT 1`).all();
    const before = await env.DB.prepare(`SELECT id, display_order FROM finance_categories ORDER BY type, display_order, id`).all();

    const response = await moveCategory({ request: authedRequest(`https://x/api/finance/categories/${lastExpense[0].id}/move`, adminToken, 'PATCH', { direction: 'down' }), env, params: { id: String(lastExpense[0].id) } });
    expect(response.status).toBe(200);

    const after = await env.DB.prepare(`SELECT id, display_order FROM finance_categories ORDER BY type, display_order, id`).all();
    expect(after.results).toEqual(before.results); // entire table untouched, including every income row
  });
});
