// v4/functions/api/asset-inventory-food-lots/index.js
import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function coerceRow(r) {
  return {
    id: r.id,
    categoryId: r.category_id,
    locationId: r.location_id,
    receivedDate: r.received_date,
    expiryDate: r.expiry_date,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const categoryId = url.searchParams.get('categoryId');
  const locationId = url.searchParams.get('locationId');
  const expiringWithinDays = url.searchParams.get('expiringWithinDays');

  const clauses = [];
  const params = [];
  if (categoryId) { clauses.push('category_id = ?'); params.push(Number(categoryId)); }
  if (locationId) { clauses.push('location_id = ?'); params.push(Number(locationId)); }
  if (expiringWithinDays) {
    const days = Number(expiringWithinDays);
    if (Number.isFinite(days) && days >= 0) {
      const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      clauses.push('expiry_date IS NOT NULL AND expiry_date <= ?');
      params.push(cutoff);
    }
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT * FROM asset_inventory_food_lots ${where}
     ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, id`
  ).bind(...params).all();

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
  const { categoryId, locationId, receivedDate, expiryDate, note } = body || {};

  const category = await env.DB.prepare(`SELECT id, management_type FROM asset_categories WHERE id = ?`).bind(categoryId).first();
  if (!category) return jsonError('Không tìm thấy danh mục', 404);
  if (category.management_type !== 'food_beverage') return jsonError('Chỉ tạo lô cho danh mục thực phẩm/thức uống', 400);
  const location = await env.DB.prepare(`SELECT id FROM asset_locations WHERE id = ?`).bind(locationId).first();
  if (!location) return jsonError('Không tìm thấy vị trí', 404);

  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO asset_inventory_food_lots (category_id, location_id, received_date, expiry_date, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(categoryId, locationId, receivedDate || null, expiryDate || null, note || null, auth.username, now).run();

  return new Response(JSON.stringify({ id: insert.meta.last_row_id, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
