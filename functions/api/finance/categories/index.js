import { requireAuth } from '../../../../lib/requireAuth.js';
import { slugify } from '../../../../lib/financeCategories.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID_TYPES = ['income', 'expense'];

function coerceRow(r) {
  return {
    id: r.id,
    slug: r.slug,
    label: r.label,
    type: r.type,
    isActive: !!r.is_active,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['manager', 'admin', 'observer']);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(`SELECT * FROM finance_categories ORDER BY type, id`).all();
  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { label, type } = body || {};

  if (typeof label !== 'string' || label.trim() === '') return jsonError('Tên danh mục không được để trống', 400);
  if (!VALID_TYPES.includes(type)) return jsonError('Loại danh mục không hợp lệ', 400);

  const trimmedLabel = label.trim();
  const slug = slugify(trimmedLabel);
  if (!slug) return jsonError('Tên danh mục không hợp lệ', 400);

  const existing = await env.DB.prepare(`SELECT id FROM finance_categories WHERE slug = ?`).bind(slug).first();
  if (existing) return jsonError('Danh mục với tên tương tự đã tồn tại', 400);

  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO finance_categories (slug, label, type, is_active, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?)`
  ).bind(slug, trimmedLabel, type, auth.username, now).run();
  const newId = insert.meta.last_row_id;

  await env.DB.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, entity_label, old_value, new_value, actor, created_at)
     VALUES ('finance_category_create', 'finance_category', ?, ?, NULL, ?, ?, ?)`
  ).bind(newId, trimmedLabel, trimmedLabel, auth.username, now).run();

  return new Response(JSON.stringify({ id: newId, slug, label: trimmedLabel, type, isActive: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
