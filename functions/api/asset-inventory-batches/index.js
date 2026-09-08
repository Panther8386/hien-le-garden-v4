// v4/functions/api/asset-inventory-batches/index.js
import { requireAuth } from '../../../lib/requireAuth.js';

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function coerceRow(r) {
  return {
    id: r.id,
    locationId: r.location_id,
    label: r.label,
    status: r.status,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    closedBy: r.closed_by,
    closedAt: r.closed_at,
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager', 'reception', 'observer']);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const locationId = url.searchParams.get('locationId');
  const status = url.searchParams.get('status');

  const clauses = [];
  const params = [];
  if (locationId) { clauses.push('location_id = ?'); params.push(Number(locationId)); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT * FROM asset_inventory_batches ${where} ORDER BY id DESC`
  ).bind(...params).all();

  return new Response(JSON.stringify(results.map(coerceRow)), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, ['admin', 'manager']);
  if (auth instanceof Response) return auth;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Dữ liệu không hợp lệ', 400);
  }
  const { locationId, label, note } = body || {};

  if (!Number.isInteger(locationId)) return jsonError('Vui lòng chọn vị trí', 400);
  const location = await env.DB.prepare(`SELECT id, name FROM asset_locations WHERE id = ? AND is_active = 1`).bind(locationId).first();
  if (!location) return jsonError('Không tìm thấy vị trí hoặc vị trí đã ngừng sử dụng', 400);

  const now = new Date().toISOString();
  const resolvedLabel = typeof label === 'string' && label.trim() !== '' ? label.trim() : `${location.name} - ${now.slice(0, 10)}`;

  const insert = await env.DB.prepare(
    `INSERT INTO asset_inventory_batches (location_id, label, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(locationId, resolvedLabel, note || null, auth.username, now).run();
  const batchId = insert.meta.last_row_id;

  const { results: assetsAtLocation } = await env.DB.prepare(
    `SELECT id, quantity FROM assets WHERE location_id = ? AND is_deleted = 0`
  ).bind(locationId).all();

  if (assetsAtLocation.length > 0) {
    const lineInserts = assetsAtLocation.map((a) =>
      env.DB.prepare(`INSERT INTO asset_inventory_lines (batch_id, asset_id, book_quantity) VALUES (?, ?, ?)`).bind(batchId, a.id, a.quantity)
    );
    await env.DB.batch(lineInserts);
  }

  return new Response(JSON.stringify({ id: batchId, ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
